import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const PASSIVE_KEY  = 'finance_passive'
const RENTALS_KEY  = 'finance_rentals'

const STREAM_TYPES = [
  { value: 'dividend',  label: 'Dividends / Interest', color: '#10b981' },
  { value: 'business',  label: 'Side Business / Royalties', color: '#6366f1' },
  { value: 'other',     label: 'Other',                color: '#64748b' },
]

const FREQUENCIES = ['Monthly', 'Quarterly', 'Annual']

const EMPTY_STREAM = {
  id: '', name: '', type: 'dividend', amount: 0, frequency: 'Monthly', source: '',
}

function load() {
  try {
    const s = localStorage.getItem(PASSIVE_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function loadRentals() {
  try {
    const s = localStorage.getItem(RENTALS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function toMonthly(amount, frequency) {
  if (frequency === 'Annual')    return amount / 12
  if (frequency === 'Quarterly') return amount / 3
  return amount
}

function calcRentalNCF(p) {
  const expenses =
    (p.expenses?.taxes       || 0) +
    (p.expenses?.insurance   || 0) +
    (p.expenses?.hoa         || 0) +
    (p.expenses?.maintenance || 0) +
    (p.expenses?.other       || 0)

  const effectiveRent = p.occupied
    ? (p.monthlyRent || 0) * (1 - (p.vacancyRate || 0) / 100)
    : 0

  return effectiveRent - (p.mortgagePayment || 0) - expenses
}

function fmtFull(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDecimal(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function PassiveIncome() {
  const [streams,  setStreams]  = useState(load)
  const [rentals,  setRentals]  = useState(loadRentals)
  const [editing,  setEditing]  = useState(null)   // id or 'new'
  const [draft,    setDraft]    = useState(null)

  // Reload rentals on focus (in case user updated them in the Rentals tab)
  useEffect(() => {
    function onFocus() { setRentals(loadRentals()) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    localStorage.setItem(PASSIVE_KEY, JSON.stringify(streams))
    setAppData('passive_income', streams).catch(console.error)
  }, [streams])

  // ── Monthly income computations ────────────────────────────
  const rentalMonthly = useMemo(() =>
    rentals.reduce((s, p) => s + Math.max(0, calcRentalNCF(p)), 0)
  , [rentals])

  const streamMonthly = useMemo(() =>
    streams.reduce((s, st) => s + toMonthly(st.amount || 0, st.frequency), 0)
  , [streams])

  const totalMonthly = rentalMonthly + streamMonthly
  const totalAnnual  = totalMonthly * 12

  // ── FI% calculation from transaction history ───────────────
  const monthlyExpenses = useMemo(() => {
    try {
      const txRaw = localStorage.getItem('finance_transactions')
      const txs = txRaw ? JSON.parse(txRaw) : []
      const now = new Date()
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10)
      const recent = txs.filter(tx => tx.type === 'expense' && tx.date >= cutoff)
      if (!recent.length) return 0
      const byMonth = {}
      recent.forEach(tx => {
        const m = tx.date.slice(0, 7)
        byMonth[m] = (byMonth[m] || 0) + (tx.amount || 0)
      })
      const vals = Object.values(byMonth)
      return vals.reduce((s, v) => s + v, 0) / vals.length
    } catch { return 0 }
  }, [])

  const fiPct = monthlyExpenses > 0 ? Math.min((totalMonthly / monthlyExpenses) * 100, 100) : 0

  // ── Chart data ────────────────────────────────────────────
  const chartData = useMemo(() => {
    const data = []
    if (rentalMonthly > 0) {
      data.push({ name: 'Rental Net Income', value: +(rentalMonthly.toFixed(2)), color: '#3b82f6' })
    }
    const grouped = {}
    streams.forEach(st => {
      const monthly = toMonthly(st.amount || 0, st.frequency)
      if (monthly <= 0) return
      const key = st.type
      grouped[key] = (grouped[key] || 0) + monthly
    })
    Object.entries(grouped).forEach(([type, val]) => {
      const def = STREAM_TYPES.find(t => t.value === type)
      data.push({ name: def?.label ?? type, value: +(val.toFixed(2)), color: def?.color ?? '#64748b' })
    })
    return data
  }, [rentalMonthly, streams])

  function startAdd() {
    setDraft({ ...EMPTY_STREAM, id: crypto.randomUUID() })
    setEditing('new')
  }

  function startEdit(st) {
    setDraft({ ...st })
    setEditing(st.id)
  }

  function cancelEdit() {
    setDraft(null)
    setEditing(null)
  }

  function saveDraft() {
    if (!draft) return
    if (editing === 'new') {
      setStreams(prev => [...prev, draft])
    } else {
      setStreams(prev => prev.map(s => s.id === draft.id ? draft : s))
    }
    cancelEdit()
  }

  function deleteStream(id) {
    setStreams(prev => prev.filter(s => s.id !== id))
    if (editing === id) cancelEdit()
  }

  return (
    <div className="passive-page">

      {/* ── Summary header ── */}
      <div className="card passive-hero-card">
        <div className="passive-hero-header">
          <div>
            <h2>Passive Income</h2>
            <p className="bp-subtitle">Rental net income + dividends + other streams</p>
          </div>
          <button className="bills-btn-primary" onClick={startAdd}>+ Add Stream</button>
        </div>

        <div className="passive-totals-row">
          <div className="passive-total-block">
            <span className="passive-total-label">Monthly Passive</span>
            <span className="passive-total-val" style={{ color: totalMonthly >= 0 ? '#10b981' : '#ef4444' }}>
              {fmtFull(totalMonthly)}
            </span>
          </div>
          <div className="passive-total-block">
            <span className="passive-total-label">Annual Passive</span>
            <span className="passive-total-val" style={{ color: '#6366f1' }}>
              {fmtFull(totalAnnual)}
            </span>
          </div>
          {rentalMonthly > 0 && (
            <div className="passive-total-block">
              <span className="passive-total-label">From Rentals</span>
              <span className="passive-total-val" style={{ color: '#3b82f6' }}>{fmtFull(rentalMonthly)}/mo</span>
            </div>
          )}
          {streamMonthly > 0 && (
            <div className="passive-total-block">
              <span className="passive-total-label">Other Streams</span>
              <span className="passive-total-val" style={{ color: '#10b981' }}>{fmtFull(streamMonthly)}/mo</span>
            </div>
          )}
        </div>

        {/* FI progress bar */}
        {monthlyExpenses > 0 && (
          <div className="passive-fi-section">
            <div className="passive-fi-header">
              <span className="passive-fi-label">Financial Independence Progress</span>
              <span className="passive-fi-pct" style={{ color: fiPct >= 100 ? '#059669' : fiPct >= 50 ? '#6366f1' : '#f59e0b' }}>
                {fiPct.toFixed(1)}%
              </span>
            </div>
            <div className="passive-fi-bar-track">
              <div
                className="passive-fi-bar-fill"
                style={{
                  width: `${fiPct}%`,
                  background: fiPct >= 100 ? '#059669' : fiPct >= 50 ? '#6366f1' : '#f59e0b',
                }}
              />
            </div>
            <p className="bp-subtitle" style={{ marginTop: 6 }}>
              {fmtFull(totalMonthly)}/mo passive vs {fmtFull(monthlyExpenses)}/mo avg expenses (last 3 months)
              {fiPct >= 100 ? ' — You have reached Financial Independence!' : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Chart ── */}
      {chartData.length > 0 && (
        <div className="card passive-chart-card">
          <h3>Income Breakdown</h3>
          <div className="passive-chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80} innerRadius={45}
                  paddingAngle={2}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [fmtFull(v) + '/mo', '']} />
                <Legend formatter={(name) => name} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Rental streams (read-only) ── */}
      {rentals.length > 0 && (
        <div className="card passive-section-card">
          <div className="passive-section-header">
            <h3>Rental Income</h3>
            <span className="bp-subtitle">Net cash flow from Rentals tab · edit there</span>
          </div>
          <div className="passive-streams-list">
            {rentals.map(p => {
              const ncf = calcRentalNCF(p)
              return (
                <div key={p.id} className="passive-stream-row passive-stream-readonly">
                  <div className="passive-stream-info">
                    <span className="passive-stream-name">{p.nickname || p.address || 'Property'}</span>
                    <span className="passive-stream-source">{p.address || ''}</span>
                  </div>
                  <div className="passive-stream-right">
                    {!p.occupied && (
                      <span className="rentals-occupancy-badge vacant">Vacant</span>
                    )}
                    <span className="passive-stream-amount" style={{ color: ncf >= 0 ? '#10b981' : '#ef4444' }}>
                      {ncf >= 0 ? '+' : ''}{fmtFull(ncf)}/mo
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Manual streams ── */}
      {(streams.length > 0 || editing === 'new') && (
        <div className="card passive-section-card">
          <div className="passive-section-header">
            <h3>Income Streams</h3>
            {editing !== 'new' && (
              <button className="bills-btn-primary" style={{ fontSize: '0.82rem', padding: '5px 12px' }} onClick={startAdd}>
                + Add
              </button>
            )}
          </div>

          {editing === 'new' && draft && (
            <StreamForm
              draft={draft}
              onChange={(f, v) => setDraft(p => ({ ...p, [f]: v }))}
              onSave={saveDraft}
              onCancel={cancelEdit}
              isNew
            />
          )}

          <div className="passive-streams-list">
            {streams.map(st => {
              const monthly = toMonthly(st.amount || 0, st.frequency)
              const def = STREAM_TYPES.find(t => t.value === st.type)

              if (editing === st.id && draft) {
                return (
                  <StreamForm
                    key={st.id}
                    draft={draft}
                    onChange={(f, v) => setDraft(p => ({ ...p, [f]: v }))}
                    onSave={saveDraft}
                    onCancel={cancelEdit}
                    onDelete={() => deleteStream(st.id)}
                  />
                )
              }

              return (
                <div key={st.id} className="passive-stream-row">
                  <div className="passive-stream-type-dot" style={{ background: def?.color }} />
                  <div className="passive-stream-info">
                    <span className="passive-stream-name">{st.name || '—'}</span>
                    <span className="passive-stream-source">
                      {def?.label}{st.source ? ` · ${st.source}` : ''} · {st.frequency}
                    </span>
                  </div>
                  <div className="passive-stream-right">
                    <span className="passive-stream-amount" style={{ color: '#10b981' }}>
                      +{fmtDecimal(monthly)}/mo
                    </span>
                    <span className="passive-stream-annual">({fmtDecimal(monthly * 12)}/yr)</span>
                    <button className="bills-btn-ghost" style={{ fontSize: '0.78rem', padding: '3px 8px' }}
                      onClick={() => startEdit(st)}>Edit</button>
                    <button className="bp-delete" onClick={() => deleteStream(st.id)}>×</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!streams.length && !rentals.length && editing !== 'new' && (
        <div className="card passive-empty-card">
          <div className="empty-state">
            <p>No passive income streams yet.</p>
            <p className="bp-subtitle" style={{ marginTop: 6 }}>
              Add rental properties in the Rentals tab, or track dividends and other income here.
            </p>
            <button className="bills-btn-primary" style={{ marginTop: 12 }} onClick={startAdd}>
              + Add Income Stream
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

function StreamForm({ draft, onChange, onSave, onCancel, onDelete, isNew }) {
  function num(v) { return parseFloat(v) || 0 }

  return (
    <div className="passive-stream-form">
      <div className="passive-form-grid">
        <div className="rc-field">
          <label className="rc-label">Name *</label>
          <input className="bills-input" value={draft.name}
            placeholder="e.g. VXUS Dividends"
            onChange={e => onChange('name', e.target.value)} />
        </div>

        <div className="rc-field">
          <label className="rc-label">Type</label>
          <select className="bills-select" value={draft.type}
            onChange={e => onChange('type', e.target.value)}>
            {STREAM_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="rc-field">
          <label className="rc-label">Amount</label>
          <div className="nw-num-wrap">
            <span className="nw-prefix">$</span>
            <input className="nw-num-input" type="number" min="0" step="50"
              value={draft.amount || ''} placeholder="0"
              onChange={e => onChange('amount', num(e.target.value))} />
          </div>
        </div>

        <div className="rc-field">
          <label className="rc-label">Frequency</label>
          <select className="bills-select" value={draft.frequency}
            onChange={e => onChange('frequency', e.target.value)}>
            {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>

        <div className="rc-field passive-form-full">
          <label className="rc-label">Source / Notes</label>
          <input className="bills-input" value={draft.source || ''}
            placeholder="e.g. Fidelity brokerage, Etsy shop..."
            onChange={e => onChange('source', e.target.value)} />
        </div>
      </div>

      <div className="rentals-form-actions">
        <button className="bills-btn-primary" onClick={onSave}>
          {isNew ? 'Add Stream' : 'Save'}
        </button>
        <button className="bills-btn-ghost" onClick={onCancel}>Cancel</button>
        {!isNew && onDelete && (
          <button className="bp-delete" style={{ marginLeft: 'auto' }} onClick={onDelete}>Delete</button>
        )}
      </div>
    </div>
  )
}
