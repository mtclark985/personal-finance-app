import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'

const RENTALS_KEY = 'finance_rentals'

const EMPTY_PROPERTY = {
  id: '',
  nickname: '',
  address: '',
  propertyValue: 0,
  purchasePrice: 0,
  purchaseDate: '',
  appreciationRate: 3,
  mortgageBalance: 0,
  mortgagePayment: 0,
  mortgageRate: 0,
  mortgageTermMonths: 0,
  monthlyRent: 0,
  vacancyRate: 5,
  occupied: true,
  expenses: {
    taxes: 0,
    insurance: 0,
    hoa: 0,
    maintenance: 0,
    other: 0,
  },
  notes: '',
}

function load() {
  try {
    const s = localStorage.getItem(RENTALS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function fmt(n) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-$' : '$'
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

function fmtFull(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(n, decimals = 1) {
  return `${n >= 0 ? '' : ''}${n.toFixed(decimals)}%`
}

function calcProperty(p) {
  const totalExpenses =
    (p.expenses?.taxes       || 0) +
    (p.expenses?.insurance   || 0) +
    (p.expenses?.hoa         || 0) +
    (p.expenses?.maintenance || 0) +
    (p.expenses?.other       || 0)

  const effectiveRent = p.occupied
    ? (p.monthlyRent || 0) * (1 - (p.vacancyRate || 0) / 100)
    : 0

  const netCashFlow = effectiveRent - (p.mortgagePayment || 0) - totalExpenses
  const noi         = (p.monthlyRent || 0) * 12 - totalExpenses * 12
  const equity      = (p.propertyValue || 0) - (p.mortgageBalance || 0)
  const capRate     = p.propertyValue > 0 ? (noi / p.propertyValue) * 100 : 0

  // Cash-on-cash: annual net cash flow / initial equity invested
  const annualNCF   = netCashFlow * 12
  const cashOnCash  = equity > 0 ? (annualNCF / equity) * 100 : 0

  const appreciationGain = p.purchasePrice > 0
    ? (p.propertyValue || 0) - p.purchasePrice
    : 0

  return { totalExpenses, effectiveRent, netCashFlow, noi, equity, capRate, cashOnCash, appreciationGain }
}

export default function RentalProperties() {
  const [properties, setProperties] = useState(load)
  const [editing,    setEditing]    = useState(null)   // id of expanded property, or 'new'
  const [draft,      setDraft]      = useState(null)

  useEffect(() => {
    localStorage.setItem(RENTALS_KEY, JSON.stringify(properties))
    setAppData('rental_properties', properties).catch(console.error)
  }, [properties])

  const portfolio = useMemo(() => {
    if (!properties.length) return null
    const calcs = properties.map(p => ({ p, c: calcProperty(p) }))
    return {
      totalValue:     calcs.reduce((s, x) => s + (x.p.propertyValue || 0), 0),
      totalEquity:    calcs.reduce((s, x) => s + x.c.equity, 0),
      totalRent:      calcs.reduce((s, x) => s + (x.p.occupied ? (x.p.monthlyRent || 0) : 0), 0),
      totalExpenses:  calcs.reduce((s, x) => s + x.c.totalExpenses, 0),
      totalNCF:       calcs.reduce((s, x) => s + x.c.netCashFlow, 0),
      totalMortgage:  calcs.reduce((s, x) => s + (x.p.mortgageBalance || 0), 0),
      count:          properties.length,
      occupiedCount:  properties.filter(p => p.occupied).length,
    }
  }, [properties])

  function startAdd() {
    const fresh = { ...EMPTY_PROPERTY, id: crypto.randomUUID(), expenses: { ...EMPTY_PROPERTY.expenses } }
    setDraft(fresh)
    setEditing('new')
  }

  function startEdit(p) {
    setDraft({ ...p, expenses: { ...p.expenses } })
    setEditing(p.id)
  }

  function cancelEdit() {
    setDraft(null)
    setEditing(null)
  }

  function saveDraft() {
    if (!draft) return
    if (editing === 'new') {
      setProperties(prev => [...prev, draft])
    } else {
      setProperties(prev => prev.map(p => p.id === draft.id ? draft : p))
    }
    cancelEdit()
  }

  function deleteProperty(id) {
    setProperties(prev => prev.filter(p => p.id !== id))
    if (editing === id) cancelEdit()
  }

  function toggleOccupied(id) {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, occupied: !p.occupied } : p))
  }

  function setDraftField(field, val) {
    setDraft(p => ({ ...p, [field]: val }))
  }

  function setDraftExpense(field, val) {
    setDraft(p => ({ ...p, expenses: { ...p.expenses, [field]: val } }))
  }

  return (
    <div className="rentals-page">

      {/* ── Portfolio Summary ── */}
      {portfolio && (
        <div className="card rentals-portfolio-card">
          <div className="rentals-portfolio-header">
            <div>
              <h2>Rental Portfolio</h2>
              <p className="bp-subtitle">
                {portfolio.count} propert{portfolio.count !== 1 ? 'ies' : 'y'} ·{' '}
                {portfolio.occupiedCount} occupied
              </p>
            </div>
            <button className="bills-btn-primary" onClick={startAdd}>+ Add Property</button>
          </div>

          <div className="rentals-portfolio-grid">
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Total Value</span>
              <span className="rentals-stat-val">{fmtFull(portfolio.totalValue)}</span>
            </div>
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Total Equity</span>
              <span className="rentals-stat-val" style={{ color: '#6366f1' }}>{fmtFull(portfolio.totalEquity)}</span>
            </div>
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Mortgage Debt</span>
              <span className="rentals-stat-val" style={{ color: '#ef4444' }}>−{fmtFull(portfolio.totalMortgage)}</span>
            </div>
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Gross Rent/mo</span>
              <span className="rentals-stat-val" style={{ color: '#10b981' }}>{fmtFull(portfolio.totalRent)}</span>
            </div>
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Expenses/mo</span>
              <span className="rentals-stat-val" style={{ color: '#f59e0b' }}>{fmtFull(portfolio.totalExpenses)}</span>
            </div>
            <div className="rentals-portfolio-stat">
              <span className="rentals-stat-label">Net Cash Flow/mo</span>
              <span className="rentals-stat-val" style={{ color: portfolio.totalNCF >= 0 ? '#10b981' : '#ef4444' }}>
                {portfolio.totalNCF >= 0 ? '+' : ''}{fmtFull(portfolio.totalNCF)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!properties.length && editing !== 'new' && (
        <div className="card rentals-empty-card">
          <div className="empty-state">
            <p>No rental properties yet.</p>
            <button className="bills-btn-primary" style={{ marginTop: 12 }} onClick={startAdd}>
              + Add Your First Property
            </button>
          </div>
        </div>
      )}

      {/* ── Add form ── */}
      {editing === 'new' && draft && (
        <PropertyForm
          draft={draft}
          onFieldChange={setDraftField}
          onExpenseChange={setDraftExpense}
          onSave={saveDraft}
          onCancel={cancelEdit}
          isNew
        />
      )}

      {/* ── Property cards ── */}
      {properties.map(p => {
        const c = calcProperty(p)
        const isEditing = editing === p.id

        if (isEditing && draft) {
          return (
            <PropertyForm
              key={p.id}
              draft={draft}
              onFieldChange={setDraftField}
              onExpenseChange={setDraftExpense}
              onSave={saveDraft}
              onCancel={cancelEdit}
              onDelete={() => deleteProperty(p.id)}
            />
          )
        }

        return (
          <div key={p.id} className="card rentals-card">
            <div className="rentals-card-header">
              <div className="rentals-card-title-group">
                <div className="rentals-card-title">
                  {p.nickname || 'Untitled Property'}
                  <span
                    className={`rentals-occupancy-badge ${p.occupied ? 'occupied' : 'vacant'}`}
                    onClick={() => toggleOccupied(p.id)}
                    title="Click to toggle"
                    style={{ cursor: 'pointer' }}
                  >
                    {p.occupied ? 'Occupied' : 'Vacant'}
                  </span>
                </div>
                {p.address && <div className="rentals-card-address">{p.address}</div>}
              </div>
              <div className="rentals-card-actions">
                <button className="bills-btn-ghost" onClick={() => startEdit(p)}>Edit</button>
                <button className="bp-delete" onClick={() => deleteProperty(p.id)} title="Delete">×</button>
              </div>
            </div>

            <div className="rentals-stats-grid">
              {/* Property value & equity */}
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Property Value</span>
                <span className="rentals-stat-big">{fmtFull(p.propertyValue || 0)}</span>
              </div>
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Equity</span>
                <span className="rentals-stat-big" style={{ color: '#6366f1' }}>{fmtFull(c.equity)}</span>
              </div>
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Mortgage Balance</span>
                <span className="rentals-stat-big" style={{ color: '#ef4444' }}>
                  {p.mortgageBalance > 0 ? `−${fmtFull(p.mortgageBalance)}` : '—'}
                </span>
              </div>

              {/* Cash flow */}
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Gross Rent/mo</span>
                <span className="rentals-stat-big" style={{ color: '#10b981' }}>
                  {p.monthlyRent > 0 ? fmtFull(p.monthlyRent) : '—'}
                </span>
              </div>
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Expenses/mo</span>
                <span className="rentals-stat-big" style={{ color: '#f59e0b' }}>
                  {fmtFull(c.totalExpenses + (p.mortgagePayment || 0))}
                </span>
              </div>
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Net Cash Flow/mo</span>
                <span className="rentals-stat-big" style={{ color: c.netCashFlow >= 0 ? '#10b981' : '#ef4444' }}>
                  {c.netCashFlow >= 0 ? '+' : ''}{fmtFull(c.netCashFlow)}
                </span>
              </div>

              {/* Returns */}
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Cap Rate</span>
                <span className="rentals-stat-big">{pct(c.capRate)}</span>
              </div>
              <div className="rentals-stat-block">
                <span className="rentals-stat-label">Cash-on-Cash</span>
                <span className="rentals-stat-big" style={{ color: c.cashOnCash >= 0 ? '#10b981' : '#ef4444' }}>
                  {pct(c.cashOnCash)}
                </span>
              </div>
              {c.appreciationGain !== 0 && (
                <div className="rentals-stat-block">
                  <span className="rentals-stat-label">Appreciation Gain</span>
                  <span className="rentals-stat-big" style={{ color: c.appreciationGain >= 0 ? '#10b981' : '#ef4444' }}>
                    {c.appreciationGain >= 0 ? '+' : ''}{fmtFull(c.appreciationGain)}
                  </span>
                </div>
              )}
            </div>

            {/* Expense breakdown */}
            {c.totalExpenses > 0 && (
              <div className="rentals-expense-row">
                {p.expenses?.taxes       > 0 && <span className="rentals-exp-chip">Tax {fmt(p.expenses.taxes)}</span>}
                {p.expenses?.insurance   > 0 && <span className="rentals-exp-chip">Ins {fmt(p.expenses.insurance)}</span>}
                {p.expenses?.hoa         > 0 && <span className="rentals-exp-chip">HOA {fmt(p.expenses.hoa)}</span>}
                {p.expenses?.maintenance > 0 && <span className="rentals-exp-chip">Maint {fmt(p.expenses.maintenance)}</span>}
                {p.expenses?.other       > 0 && <span className="rentals-exp-chip">Other {fmt(p.expenses.other)}</span>}
                {p.mortgagePayment       > 0 && <span className="rentals-exp-chip rentals-exp-mortgage">Mtg {fmt(p.mortgagePayment)}</span>}
              </div>
            )}

            {!p.occupied && (
              <div className="rentals-vacant-banner">
                Vacant — {p.vacancyRate > 0 ? `${p.vacancyRate}% vacancy rate` : 'no rent income'}
                {p.mortgagePayment > 0 && ` · carrying cost ${fmtFull(c.totalExpenses + p.mortgagePayment)}/mo`}
              </div>
            )}

            {p.notes && <p className="rentals-notes">{p.notes}</p>}
          </div>
        )
      })}

    </div>
  )
}

function PropertyForm({ draft, onFieldChange, onExpenseChange, onSave, onCancel, onDelete, isNew }) {
  function num(val) { return parseFloat(val) || 0 }

  return (
    <div className="card rentals-card rentals-form-card">
      <div className="rentals-card-header">
        <h3 className="rentals-form-title">{isNew ? 'Add Property' : 'Edit Property'}</h3>
        <div className="rentals-card-actions">
          {!isNew && onDelete && (
            <button className="bp-delete" onClick={onDelete} title="Delete property">×</button>
          )}
        </div>
      </div>

      <div className="rentals-form-grid">
        {/* Basic info */}
        <div className="rentals-form-section">
          <div className="rentals-form-section-label">Property Info</div>

          <div className="rc-field">
            <label className="rc-label">Nickname *</label>
            <input className="bills-input" value={draft.nickname}
              placeholder="e.g. Oak St Duplex"
              onChange={e => onFieldChange('nickname', e.target.value)} />
          </div>

          <div className="rc-field">
            <label className="rc-label">Address</label>
            <input className="bills-input" value={draft.address}
              placeholder="123 Main St, City, ST"
              onChange={e => onFieldChange('address', e.target.value)} />
          </div>

          <div className="rentals-form-row">
            <div className="rc-field">
              <label className="rc-label">Current Value</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input className="nw-num-input" type="number" min="0" step="1000"
                  value={draft.propertyValue || ''} placeholder="0"
                  onChange={e => onFieldChange('propertyValue', num(e.target.value))} />
              </div>
            </div>

            <div className="rc-field">
              <label className="rc-label">Appreciation Rate</label>
              <div className="nw-num-wrap">
                <input className="nw-num-input" type="number" min="0" max="20" step="0.5"
                  style={{ width: 55 }}
                  value={draft.appreciationRate ?? 3}
                  onChange={e => onFieldChange('appreciationRate', num(e.target.value))} />
                <span className="nw-suffix">%/yr</span>
              </div>
            </div>
          </div>

          <div className="rentals-form-row">
            <div className="rc-field">
              <label className="rc-label">Purchase Price</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input className="nw-num-input" type="number" min="0" step="1000"
                  value={draft.purchasePrice || ''} placeholder="0"
                  onChange={e => onFieldChange('purchasePrice', num(e.target.value))} />
              </div>
            </div>

            <div className="rc-field">
              <label className="rc-label">Purchase Date</label>
              <input className="bills-input" type="date" value={draft.purchaseDate || ''}
                onChange={e => onFieldChange('purchaseDate', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Mortgage */}
        <div className="rentals-form-section">
          <div className="rentals-form-section-label">Mortgage</div>

          <div className="rentals-form-row">
            <div className="rc-field">
              <label className="rc-label">Balance</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input className="nw-num-input" type="number" min="0" step="1000"
                  value={draft.mortgageBalance || ''} placeholder="0"
                  onChange={e => onFieldChange('mortgageBalance', num(e.target.value))} />
              </div>
            </div>

            <div className="rc-field">
              <label className="rc-label">Monthly Payment</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input className="nw-num-input" type="number" min="0" step="50"
                  value={draft.mortgagePayment || ''} placeholder="0"
                  onChange={e => onFieldChange('mortgagePayment', num(e.target.value))} />
              </div>
            </div>
          </div>

          <div className="rentals-form-row">
            <div className="rc-field">
              <label className="rc-label">Interest Rate</label>
              <div className="nw-num-wrap">
                <input className="nw-num-input" type="number" min="0" max="20" step="0.125"
                  style={{ width: 55 }}
                  value={draft.mortgageRate || ''} placeholder="0"
                  onChange={e => onFieldChange('mortgageRate', num(e.target.value))} />
                <span className="nw-suffix">%</span>
              </div>
            </div>

            <div className="rc-field">
              <label className="rc-label">Months Remaining</label>
              <input className="nw-num-input" type="number" min="0" step="12"
                style={{ width: 70 }}
                value={draft.mortgageTermMonths || ''} placeholder="0"
                onChange={e => onFieldChange('mortgageTermMonths', num(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Rent & occupancy */}
        <div className="rentals-form-section">
          <div className="rentals-form-section-label">Rent &amp; Occupancy</div>

          <div className="rentals-form-row">
            <div className="rc-field">
              <label className="rc-label">Monthly Rent</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input className="nw-num-input" type="number" min="0" step="50"
                  value={draft.monthlyRent || ''} placeholder="0"
                  onChange={e => onFieldChange('monthlyRent', num(e.target.value))} />
              </div>
            </div>

            <div className="rc-field">
              <label className="rc-label">Vacancy Rate</label>
              <div className="nw-num-wrap">
                <input className="nw-num-input" type="number" min="0" max="100" step="1"
                  style={{ width: 55 }}
                  value={draft.vacancyRate ?? 5}
                  onChange={e => onFieldChange('vacancyRate', num(e.target.value))} />
                <span className="nw-suffix">%</span>
              </div>
            </div>
          </div>

          <label className="rentals-occupied-toggle">
            <input
              type="checkbox"
              checked={!!draft.occupied}
              onChange={e => onFieldChange('occupied', e.target.checked)}
            />
            <span>Currently Occupied</span>
          </label>
        </div>

        {/* Expenses */}
        <div className="rentals-form-section">
          <div className="rentals-form-section-label">Monthly Expenses (excl. mortgage)</div>

          <div className="rentals-form-row">
            {[
              { key: 'taxes',       label: 'Property Tax' },
              { key: 'insurance',   label: 'Insurance'    },
              { key: 'hoa',         label: 'HOA'          },
              { key: 'maintenance', label: 'Maintenance'  },
              { key: 'other',       label: 'Other'        },
            ].map(({ key, label }) => (
              <div key={key} className="rc-field">
                <label className="rc-label">{label}</label>
                <div className="nw-num-wrap">
                  <span className="nw-prefix">$</span>
                  <input className="nw-num-input" type="number" min="0" step="10"
                    value={draft.expenses?.[key] || ''} placeholder="0"
                    onChange={e => onExpenseChange(key, num(e.target.value))} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="rentals-form-section rentals-form-full">
          <div className="rc-field">
            <label className="rc-label">Notes</label>
            <textarea className="bills-input rentals-notes-input"
              value={draft.notes || ''} rows={2}
              placeholder="Any notes about this property..."
              onChange={e => onFieldChange('notes', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rentals-form-actions">
        <button className="bills-btn-primary" onClick={onSave}>
          {isNew ? 'Add Property' : 'Save Changes'}
        </button>
        <button className="bills-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
