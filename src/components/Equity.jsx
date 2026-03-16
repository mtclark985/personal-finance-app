import { useState, useEffect, useMemo, useCallback } from 'react'
import { setAppData } from '../lib/db'

const STORAGE_KEY = 'finance_equity'
const CLOUD_KEY   = 'equity_grants'

// ── Constants ─────────────────────────────────────────────────────────────────

const GRANT_TYPES = [
  { value: 'rsu', label: 'RSU', desc: 'Restricted Stock Unit'       },
  { value: 'iso', label: 'ISO', desc: 'Incentive Stock Option'       },
  { value: 'nso', label: 'NSO', desc: 'Non-Qualified Stock Option'   },
]

const CLIFF_OPTIONS          = [0, 3, 6, 12, 18, 24]
const VESTING_PERIOD_OPTIONS = [12, 24, 36, 48, 60]
const FREQ_MAP               = { monthly: 1, quarterly: 3, annual: 12 }

const HOUSEHOLD_KEY = 'sage_household'

const BUDGET_KEY = 'finance_budget'

function readHousehold() {
  try {
    const s = localStorage.getItem(HOUSEHOLD_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function readBudgetEquityTargets() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    if (!s) return { p1: 0, p2: 0 }
    const b = JSON.parse(s)
    return {
      p1: b.earner1?.equityTarget || 0,
      p2: b.earner2?.equityTarget || 0,
    }
  } catch { return { p1: 0, p2: 0 } }
}

// Annual RSU vest value for a given earner key from grants list
function writeBudgetEquityTarget(earnerKey, value) {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    const b = s ? JSON.parse(s) : {}
    const field = earnerKey === 'p1' ? 'earner1' : 'earner2'
    b[field] = { ...(b[field] || {}), equityTarget: value }
    localStorage.setItem(BUDGET_KEY, JSON.stringify(b))
    setAppData('budget', b).catch(() => {})
  } catch {}
}

function annualRsuVestForEarner(grants, earnerKey) {
  const today  = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() + 1)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  let total = 0
  const freqMap = { monthly: 1, quarterly: 3, annual: 12 }
  grants.forEach(g => {
    if (g.type !== 'rsu') return
    if (g.earner !== earnerKey && !(earnerKey === 'all')) return
    const price = parseFloat(g.currentPrice) || 0
    if (!price || !g.grantDate || !g.totalShares || !g.vestingMonths) return
    const freq = freqMap[g.vestingFrequency] ?? 1
    const spm  = g.totalShares / g.vestingMonths
    let cum = 0
    if (g.cliffMonths > 0) {
      const shares = Math.round(spm * g.cliffMonths)
      const d = new Date(g.grantDate + 'T00:00:00'); d.setMonth(d.getMonth() + g.cliffMonths)
      const ds = d.toISOString().slice(0, 10)
      cum += shares
      if (ds > today && ds <= cutoffStr) total += shares * price
    }
    for (let m = g.cliffMonths + freq; m <= g.vestingMonths; m += freq) {
      const isLast = m + freq > g.vestingMonths
      const shares = isLast ? g.totalShares - cum : Math.round(spm * freq)
      if (shares <= 0) continue
      const d = new Date(g.grantDate + 'T00:00:00'); d.setMonth(d.getMonth() + m)
      const ds = d.toISOString().slice(0, 10)
      cum += shares
      if (ds > today && ds <= cutoffStr) total += shares * price
    }
  })
  return total
}

const DEFAULT_FORM = {
  type:             'rsu',
  companyName:      '',
  ticker:           '',
  grantDate:        '',
  totalShares:      '',
  cliffMonths:      12,
  vestingMonths:    48,
  vestingFrequency: 'monthly',
  earner:           'p1',
  strikePrice:      '',
  grantFMV:         '',
  currentPrice:     '',
  marginalRate:     22,
  notes:            '',
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '$0'
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1) + 'M'
  if (abs >= 10_000)    return sign + '$' + (abs / 1_000).toFixed(1) + 'K'
  return sign + '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPct(n) {
  return Number(n ?? 0).toFixed(1) + '%'
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Add N months to a YYYY-MM-DD string
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

// ── Vesting schedule ──────────────────────────────────────────────────────────
//
//   sharesPerMonth = totalShares / vestingMonths
//   Cliff at grantDate + cliffMonths:  Math.round(sharesPerMonth * cliffMonths) shares
//   Post-cliff events every freqMonths starting at cliffMonths + freqMonths
//   Last post-cliff event gets the remainder so cumulative == totalShares exactly

function buildVestingSchedule(grant) {
  const { grantDate, totalShares, cliffMonths, vestingMonths, vestingFrequency } = grant
  if (!grantDate || !totalShares || !vestingMonths) return []

  const total      = Number(totalShares)
  const freqMonths = FREQ_MAP[vestingFrequency] ?? 1
  const spm        = total / vestingMonths  // shares per month
  const today      = todayStr()

  const events = []
  let cumulative = 0

  // Cliff event
  if (cliffMonths > 0) {
    const shares    = Math.round(spm * cliffMonths)
    const date      = addMonths(grantDate, cliffMonths)
    cumulative     += shares
    events.push({ date, type: 'Cliff', shares, cumulative, pct: (cumulative / total) * 100, vested: date <= today })
  }

  // Post-cliff events
  const start = cliffMonths + freqMonths
  for (let m = start; m <= vestingMonths; m += freqMonths) {
    const isLast = m + freqMonths > vestingMonths
    const shares = isLast ? total - cumulative : Math.round(spm * freqMonths)
    if (shares <= 0) continue
    const date  = addMonths(grantDate, m)
    cumulative += shares
    events.push({ date, type: 'Regular', shares, cumulative, pct: (cumulative / total) * 100, vested: date <= today })
  }

  return events
}

function computeGrantStats(grant) {
  const schedule     = buildVestingSchedule(grant)
  const price        = parseFloat(grant.currentPrice) || 0
  const total        = Number(grant.totalShares) || 0
  const vestedShares = schedule.filter(e => e.vested).reduce((s, e) => s + e.shares, 0)
  const unvested     = total - vestedShares
  const vestedPct    = total > 0 ? (vestedShares / total) * 100 : 0
  const nextEvent    = schedule.find(e => !e.vested) ?? null
  return {
    schedule,
    vestedShares,
    unvestedShares: unvested,
    vestedPct,
    nextEvent,
    currentValue:  price > 0 ? vestedShares * price : null,
    unvestedValue: price > 0 ? unvested * price : null,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Equity() {
  const [grants, setGrants] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  const [activeSection, setActiveSection] = useState('grants')
  const [showForm,      setShowForm]      = useState(false)
  const [editingId,     setEditingId]     = useState(null)
  const [form,          setForm]          = useState(DEFAULT_FORM)
  const [selectedId,    setSelectedId]    = useState(null)
  const household = readHousehold()
  const p1Label   = household?.p1 || 'Person 1'
  const p2Label   = household?.p2 || 'Person 2'

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grants))
    setAppData(CLOUD_KEY, grants).catch(console.error)
  }, [grants])

  // ── Derived ───────────────────────────────────────────────────────────────

  const grantsWithStats = useMemo(
    () => grants.map(g => ({ ...g, ...computeGrantStats(g) })),
    [grants]
  )

  const scheduleGrant = useMemo(
    () => grantsWithStats.find(g => g.id === selectedId) ?? grantsWithStats[0] ?? null,
    [grantsWithStats, selectedId]
  )

  const totalVestedValue = useMemo(
    () => grantsWithStats.reduce((s, g) => s + (g.currentValue ?? 0), 0),
    [grantsWithStats]
  )

  // Budget ↔ Equity bridge
  const [budgetTargets, setBudgetTargets] = useState(readBudgetEquityTargets)
  const annualP1 = useMemo(() => annualRsuVestForEarner(grants, 'p1'), [grants])
  const annualP2 = useMemo(() => annualRsuVestForEarner(grants, 'p2'), [grants])

  function syncToBudget(earnerKey, value) {
    writeBudgetEquityTarget(earnerKey, Math.round(value))
    setBudgetTargets(t => ({ ...t, [earnerKey]: Math.round(value) }))
  }

  // Refresh budget targets whenever grants change (in case budget was updated externally)
  useEffect(() => {
    setBudgetTargets(readBudgetEquityTargets())
  }, [grants])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function openAddForm() {
    setForm(DEFAULT_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function openEditForm(grant) {
    setForm({ ...DEFAULT_FORM, ...grant })
    setEditingId(grant.id)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(DEFAULT_FORM)
  }

  function saveGrant() {
    if (!form.companyName || !form.grantDate || !form.totalShares) return
    const id    = editingId ?? `grant_${Date.now()}`
    const grant = {
      id,
      type:             form.type,
      companyName:      form.companyName.trim(),
      ticker:           form.ticker.trim().toUpperCase(),
      grantDate:        form.grantDate,
      totalShares:      parseInt(form.totalShares) || 0,
      cliffMonths:      Number(form.cliffMonths),
      vestingMonths:    Number(form.vestingMonths),
      vestingFrequency: form.vestingFrequency,
      earner:           form.earner || 'p1',
      strikePrice:      parseFloat(form.strikePrice)  || 0,
      grantFMV:         parseFloat(form.grantFMV)     || 0,
      currentPrice:     form.currentPrice,
      marginalRate:     parseFloat(form.marginalRate) || 22,
      notes:            form.notes,
    }
    setGrants(prev =>
      editingId ? prev.map(g => g.id === editingId ? grant : g) : [...prev, grant]
    )
    closeForm()
  }

  function deleteGrant(id) {
    setGrants(prev => prev.filter(g => g.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const canSave = form.companyName && form.grantDate && form.totalShares && Number(form.totalShares) > 0

  const SECTIONS = [
    { key: 'grants',   label: 'Grants' },
    { key: 'schedule', label: 'Vesting Schedule' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="espp-wrap equity-wrap">

      {/* Header */}
      <div className="espp-header-row">
        <div>
          <h2 className="espp-title">Equity</h2>
          <p className="espp-subtitle">RSU, ISO & NSO grant tracker</p>
        </div>
        {grantsWithStats.length > 0 && (
          <div className="equity-header-summary">
            <div className="equity-header-stat">
              <span className="equity-header-stat-label">Grants</span>
              <span className="equity-header-stat-val">{grants.length}</span>
            </div>
            {totalVestedValue > 0 && (
              <div className="equity-header-stat">
                <span className="equity-header-stat-label">Vested Value</span>
                <span className="equity-header-stat-val">{fmt(totalVestedValue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section tabs */}
      <div className="espp-section-tabs">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            className={`espp-section-tab${activeSection === s.key ? ' active' : ''}`}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Grants ─────────────────────────────────────────────────────────── */}
      {activeSection === 'grants' && (
        <div className="espp-panel">
          <div className="equity-section-head">
            <h3 className="espp-panel-title">Equity Grants</h3>
            <button className="espp-btn-primary" onClick={showForm && !editingId ? closeForm : openAddForm}>
              {showForm && !editingId ? '✕ Cancel' : '+ Add Grant'}
            </button>
          </div>

          {/* Budget bridge */}
          {grants.length > 0 && (annualP1 > 0 || annualP2 > 0) && (
            <div className="equity-budget-bridge">
              <div className="equity-budget-bridge-title">Budget Equity Targets</div>
              <div className="equity-budget-bridge-rows">
                {annualP1 > 0 && (
                  <div className="equity-budget-bridge-row">
                    <span className="equity-budget-bridge-who">{p1Label}</span>
                    <span className="equity-budget-bridge-computed">
                      {fmt(annualP1)}/yr from grants
                    </span>
                    <span className="equity-budget-bridge-sep">vs.</span>
                    <span className={`equity-budget-bridge-target ${Math.round(budgetTargets.p1) === Math.round(annualP1) ? 'eq-match' : 'eq-mismatch'}`}>
                      {fmt(budgetTargets.p1)}/yr in budget
                    </span>
                    {Math.round(budgetTargets.p1) !== Math.round(annualP1) && (
                      <button className="equity-sync-btn" onClick={() => syncToBudget('p1', annualP1)}>
                        Sync to Budget ↗
                      </button>
                    )}
                    {Math.round(budgetTargets.p1) === Math.round(annualP1) && annualP1 > 0 && (
                      <span className="equity-synced-badge">✓ In sync</span>
                    )}
                  </div>
                )}
                {annualP2 > 0 && (
                  <div className="equity-budget-bridge-row">
                    <span className="equity-budget-bridge-who">{p2Label}</span>
                    <span className="equity-budget-bridge-computed">
                      {fmt(annualP2)}/yr from grants
                    </span>
                    <span className="equity-budget-bridge-sep">vs.</span>
                    <span className={`equity-budget-bridge-target ${Math.round(budgetTargets.p2) === Math.round(annualP2) ? 'eq-match' : 'eq-mismatch'}`}>
                      {fmt(budgetTargets.p2)}/yr in budget
                    </span>
                    {Math.round(budgetTargets.p2) !== Math.round(annualP2) && (
                      <button className="equity-sync-btn" onClick={() => syncToBudget('p2', annualP2)}>
                        Sync to Budget ↗
                      </button>
                    )}
                    {Math.round(budgetTargets.p2) === Math.round(annualP2) && annualP2 > 0 && (
                      <span className="equity-synced-badge">✓ In sync</span>
                    )}
                  </div>
                )}
              </div>
              <p className="equity-budget-bridge-note">
                Based on RSU vest events in the next 12 months. "Sync to Budget" updates the Equity / RSU Target in the Budget tab.
              </p>
            </div>
          )}

          {/* Add / Edit form */}
          {showForm && (
            <div className="equity-form-wrap">
              <h4 className="equity-form-title">{editingId ? 'Edit Grant' : 'New Equity Grant'}</h4>

              {/* Type toggle */}
              <div className="equity-type-toggle">
                {GRANT_TYPES.map(gt => (
                  <button
                    key={gt.value}
                    type="button"
                    className={`equity-type-btn equity-type-btn-${gt.value}${form.type === gt.value ? ' active' : ''}`}
                    onClick={() => setField('type', gt.value)}
                  >
                    <span className="equity-type-label">{gt.label}</span>
                    <span className="equity-type-desc">{gt.desc}</span>
                  </button>
                ))}
              </div>

              <div className="espp-form-grid">
                <div className="espp-field">
                  <label>Company Name</label>
                  <input value={form.companyName} onChange={e => setField('companyName', e.target.value)} placeholder="Acme Corp" />
                </div>
                <div className="espp-field">
                  <label>Ticker</label>
                  <input value={form.ticker} onChange={e => setField('ticker', e.target.value.toUpperCase())} placeholder="ACME" />
                </div>
                <div className="espp-field">
                  <label>Earner</label>
                  <select value={form.earner || 'p1'} onChange={e => setField('earner', e.target.value)}>
                    <option value="p1">{p1Label}</option>
                    <option value="p2">{p2Label}</option>
                    <option value="shared">Shared / Both</option>
                  </select>
                </div>
                <div className="espp-field">
                  <label>Grant Date</label>
                  <input type="date" value={form.grantDate} onChange={e => setField('grantDate', e.target.value)} />
                </div>
                <div className="espp-field">
                  <label>Total Shares</label>
                  <input type="number" min="1" step="1" placeholder="1000" value={form.totalShares} onChange={e => setField('totalShares', e.target.value)} />
                </div>
                <div className="espp-field">
                  <label>Cliff Period</label>
                  <select value={form.cliffMonths} onChange={e => setField('cliffMonths', Number(e.target.value))}>
                    {CLIFF_OPTIONS.map(m => (
                      <option key={m} value={m}>
                        {m === 0 ? 'No cliff' : `${m} month${m === 1 ? '' : 's'}${m === 12 ? ' (1 yr)' : m === 24 ? ' (2 yr)' : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="espp-field">
                  <label>Total Vesting Period</label>
                  <select value={form.vestingMonths} onChange={e => setField('vestingMonths', Number(e.target.value))}>
                    {VESTING_PERIOD_OPTIONS.map(m => (
                      <option key={m} value={m}>{m} months ({m / 12} yr{m / 12 !== 1 ? 's' : ''})</option>
                    ))}
                  </select>
                </div>
                <div className="espp-field">
                  <label>Vesting Frequency</label>
                  <select value={form.vestingFrequency} onChange={e => setField('vestingFrequency', e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div className="espp-field">
                  <label>Current Stock Price ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={form.currentPrice} onChange={e => setField('currentPrice', e.target.value)} />
                </div>
                <div className="espp-field">
                  <label>FMV at Grant Date ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={form.grantFMV} onChange={e => setField('grantFMV', e.target.value)} />
                </div>
                {(form.type === 'iso' || form.type === 'nso') && (
                  <div className="espp-field">
                    <label>Strike Price ($/share)</label>
                    <input type="number" min="0" step="0.01" placeholder="0.00" value={form.strikePrice} onChange={e => setField('strikePrice', e.target.value)} />
                  </div>
                )}
                <div className="espp-field">
                  <label>Marginal Tax Rate (%)</label>
                  <input type="number" min="0" max="60" value={form.marginalRate} onChange={e => setField('marginalRate', e.target.value)} />
                </div>
                <div className="espp-field espp-field-full">
                  <label>Notes</label>
                  <input placeholder="e.g. Promotion grant, cliff 2025-03-01" value={form.notes} onChange={e => setField('notes', e.target.value)} />
                </div>
              </div>

              <div className="espp-form-actions">
                <button className="espp-btn-primary" onClick={saveGrant} disabled={!canSave}>
                  {editingId ? 'Save Changes' : 'Add Grant'}
                </button>
                <button className="espp-btn-ghost" onClick={closeForm}>Cancel</button>
              </div>
            </div>
          )}

          {/* Grant cards */}
          {grantsWithStats.length === 0 && !showForm && (
            <p className="espp-empty">No equity grants yet. Click "+ Add Grant" to get started.</p>
          )}

          {grantsWithStats.length > 0 && (
            <div className="equity-cards">
              {grantsWithStats.map(grant => {
                const typeInfo = GRANT_TYPES.find(t => t.value === grant.type)
                const price    = parseFloat(grant.currentPrice) || 0
                const isOption = grant.type === 'iso' || grant.type === 'nso'
                const spread   = isOption && price > grant.strikePrice ? price - grant.strikePrice : 0

                return (
                  <div key={grant.id} className="equity-card">
                    <div className="equity-card-header">
                      <div className="equity-card-title-row">
                        <span className={`equity-type-badge equity-badge-${grant.type}`}>{typeInfo?.label}</span>
                        <span className="equity-card-company">
                          {grant.companyName || 'Unnamed Grant'}
                          {grant.ticker ? ` · ${grant.ticker}` : ''}
                        </span>
                        <span className="equity-earner-badge">
                          {grant.earner === 'p2' ? p2Label : grant.earner === 'shared' ? 'Shared' : p1Label}
                        </span>
                      </div>
                      <div className="equity-card-actions">
                        <button className="espp-lot-btn" onClick={() => { setSelectedId(grant.id); setActiveSection('schedule') }}>Schedule</button>
                        <button className="espp-lot-btn" onClick={() => openEditForm(grant)}>Edit</button>
                        <button className="espp-lot-btn espp-lot-btn-del" onClick={() => deleteGrant(grant.id)}>✕</button>
                      </div>
                    </div>

                    {/* Vesting progress bar */}
                    <div className="equity-progress-wrap">
                      <div className="equity-progress-bar">
                        <div className="equity-progress-fill" style={{ width: `${grant.vestedPct}%` }} />
                      </div>
                      <span className="equity-progress-pct">{fmtPct(grant.vestedPct)} vested</span>
                    </div>

                    {/* Stats grid */}
                    <div className="equity-card-stats">
                      <div className="equity-stat">
                        <span className="equity-stat-label">Vested Shares</span>
                        <span className="equity-stat-val equity-stat-vested">
                          {grant.vestedShares.toLocaleString()}
                          {grant.currentValue != null && <span className="equity-stat-money"> · {fmt(grant.currentValue)}</span>}
                        </span>
                      </div>
                      <div className="equity-stat">
                        <span className="equity-stat-label">Unvested</span>
                        <span className="equity-stat-val">
                          {grant.unvestedShares.toLocaleString()}
                          {grant.unvestedValue != null && <span className="equity-stat-money"> · {fmt(grant.unvestedValue)}</span>}
                        </span>
                      </div>
                      <div className="equity-stat">
                        <span className="equity-stat-label">Total Granted</span>
                        <span className="equity-stat-val">{Number(grant.totalShares).toLocaleString()} shares</span>
                      </div>
                      <div className="equity-stat">
                        <span className="equity-stat-label">Next Vest</span>
                        <span className="equity-stat-val">
                          {grant.nextEvent
                            ? `${grant.nextEvent.shares.toLocaleString()} sh · ${grant.nextEvent.date}`
                            : <span className="equity-fully-vested">Fully vested ✓</span>
                          }
                        </span>
                      </div>
                      <div className="equity-stat">
                        <span className="equity-stat-label">Grant Date</span>
                        <span className="equity-stat-val">{grant.grantDate || '—'}</span>
                      </div>
                      <div className="equity-stat">
                        <span className="equity-stat-label">Vesting Terms</span>
                        <span className="equity-stat-val">
                          {grant.cliffMonths > 0 ? `${grant.cliffMonths}mo cliff · ` : 'No cliff · '}
                          {grant.vestingMonths / 12}yr {grant.vestingFrequency}
                        </span>
                      </div>
                      {isOption && (
                        <div className="equity-stat">
                          <span className="equity-stat-label">Strike / Current</span>
                          <span className="equity-stat-val">
                            ${Number(grant.strikePrice).toFixed(2)}
                            {price > 0 && ` · $${price.toFixed(2)}`}
                            {spread > 0 && <span className="equity-stat-vested"> (+${spread.toFixed(2)} spread)</span>}
                          </span>
                        </div>
                      )}
                      {grant.type === 'rsu' && price > 0 && grant.vestedShares > 0 && (
                        <div className="equity-stat">
                          <span className="equity-stat-label">Est. Tax on Vested</span>
                          <span className="equity-stat-val equity-stat-tax">
                            {fmt(grant.currentValue * grant.marginalRate / 100)}
                            <span className="equity-stat-money"> · {grant.marginalRate}% rate</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {grant.notes && <p className="equity-card-notes">{grant.notes}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Vesting Schedule ───────────────────────────────────────────────── */}
      {activeSection === 'schedule' && (
        <div className="espp-panel">
          <div className="equity-section-head">
            <h3 className="espp-panel-title">Vesting Schedule</h3>
            {grantsWithStats.length > 1 && (
              <select
                className="equity-schedule-select"
                value={scheduleGrant?.id ?? ''}
                onChange={e => setSelectedId(e.target.value)}
              >
                {grantsWithStats.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.companyName || 'Unnamed'}{g.ticker ? ` (${g.ticker})` : ''} — {g.type.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!scheduleGrant ? (
            <p className="espp-empty">Add a grant first to see its vesting schedule.</p>
          ) : (
            <>
              <div className="equity-schedule-meta">
                <span className={`equity-type-badge equity-badge-${scheduleGrant.type}`}>
                  {scheduleGrant.type.toUpperCase()}
                </span>
                <span className="equity-schedule-meta-company">
                  {scheduleGrant.companyName}{scheduleGrant.ticker ? ` · ${scheduleGrant.ticker}` : ''}
                </span>
                <span className="equity-schedule-meta-sep">·</span>
                <span>{Number(scheduleGrant.totalShares).toLocaleString()} shares</span>
                <span className="equity-schedule-meta-sep">·</span>
                <span>
                  {scheduleGrant.cliffMonths > 0 ? `${scheduleGrant.cliffMonths}mo cliff · ` : ''}
                  {scheduleGrant.vestingMonths / 12}yr {scheduleGrant.vestingFrequency}
                </span>
                <span className="equity-schedule-meta-sep">·</span>
                <span className="equity-schedule-meta-vested">
                  {fmtPct(scheduleGrant.vestedPct)} vested
                </span>
              </div>

              <div className="cf-table-wrap">
                <table className="cf-table equity-schedule-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Vest Date</th>
                      <th style={{ textAlign: 'left' }}>Type</th>
                      <th>Shares</th>
                      <th>Cumulative</th>
                      <th>% Vested</th>
                      {parseFloat(scheduleGrant.currentPrice) > 0 && <th>Value</th>}
                      {scheduleGrant.type === 'rsu' && parseFloat(scheduleGrant.currentPrice) > 0 && <th>Est. Tax</th>}
                      <th style={{ textAlign: 'left' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleGrant.schedule.map((ev, i) => {
                      const price = parseFloat(scheduleGrant.currentPrice) || 0
                      const value = price * ev.shares
                      const tax   = scheduleGrant.type === 'rsu' && price > 0
                        ? value * scheduleGrant.marginalRate / 100 : null
                      return (
                        <tr key={i} className={ev.vested ? 'equity-row-vested' : ''}>
                          <td style={{ textAlign: 'left' }}>{ev.date}</td>
                          <td style={{ textAlign: 'left' }}>
                            {ev.type === 'Cliff'
                              ? <span className="equity-event-cliff">Cliff</span>
                              : <span className="equity-event-regular">Regular</span>
                            }
                          </td>
                          <td>{ev.shares.toLocaleString()}</td>
                          <td>{ev.cumulative.toLocaleString()}</td>
                          <td>{fmtPct(ev.pct)}</td>
                          {price > 0 && <td>{fmt(value)}</td>}
                          {scheduleGrant.type === 'rsu' && price > 0 && (
                            <td className="equity-tax-cell">{tax != null ? fmt(tax) : '—'}</td>
                          )}
                          <td style={{ textAlign: 'left' }}>
                            {ev.vested
                              ? <span className="equity-status-vested">Vested ✓</span>
                              : <span className="equity-status-pending">Pending</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="cf-table-total">
                      <td style={{ textAlign: 'left' }}>Total</td>
                      <td></td>
                      <td>{Number(scheduleGrant.totalShares).toLocaleString()}</td>
                      <td>{Number(scheduleGrant.totalShares).toLocaleString()}</td>
                      <td>100.0%</td>
                      {parseFloat(scheduleGrant.currentPrice) > 0 && (
                        <td>{fmt(Number(scheduleGrant.totalShares) * parseFloat(scheduleGrant.currentPrice))}</td>
                      )}
                      {scheduleGrant.type === 'rsu' && parseFloat(scheduleGrant.currentPrice) > 0 && (
                        <td className="equity-tax-cell">
                          {fmt(Number(scheduleGrant.totalShares) * parseFloat(scheduleGrant.currentPrice) * scheduleGrant.marginalRate / 100)}
                        </td>
                      )}
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Type-specific tax notes */}
              {scheduleGrant.type === 'iso' && (
                <div className="equity-tax-note equity-tax-note-iso">
                  <strong>ISO Tax Notes:</strong> No regular income tax at exercise (but AMT may apply). Qualifying
                  disposition requires holding &gt;2 years from grant date AND &gt;1 year from exercise date — all gain
                  is then treated as long-term capital gain. Consult a tax professional.
                </div>
              )}
              {scheduleGrant.type === 'nso' && (
                <div className="equity-tax-note equity-tax-note-nso">
                  <strong>NSO Tax Notes:</strong> At exercise, the spread (FMV − strike) is treated as ordinary income
                  taxed at your marginal rate ({scheduleGrant.marginalRate}%). Subsequent appreciation after exercise is
                  capital gain. Consult a tax professional.
                </div>
              )}
              {scheduleGrant.type === 'rsu' && (
                <div className="equity-tax-note equity-tax-note-rsu">
                  <strong>RSU Tax Notes:</strong> At each vest date, the FMV of the shares is ordinary income. Est. tax
                  shown above uses your {scheduleGrant.marginalRate}% marginal rate applied to current stock price —
                  actual tax is based on FMV at vest. Consult a tax professional.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
