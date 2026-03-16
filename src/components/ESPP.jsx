import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'

const STORAGE_KEY = 'espp_data'
const CLOUD_KEY   = 'espp_data'

const PAY_FREQS = [
  { value: 'weekly',      label: 'Weekly',       perYear: 52  },
  { value: 'biweekly',    label: 'Bi-weekly',    perYear: 26  },
  { value: 'semimonthly', label: 'Semi-monthly', perYear: 24  },
  { value: 'monthly',     label: 'Monthly',      perYear: 12  },
]

const DEFAULT_PLAN = {
  companyName: '',
  ticker: '',
  discount: 15,
  lookback: true,
  contributionPct: 10,
  salary: 80000,
  payFrequency: 'biweekly',
  maxContribution: 25000,
  offeringStart: '',
  offeringEnd: '',
  marginalRate: 22,
  recurring: false,
  planEndDate: '',
}

const DEFAULT_DATA = {
  plan: DEFAULT_PLAN,
  currentPrice: '',
  purchases: [],
}

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '$0.00'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtShares(n) {
  if (n == null || isNaN(n)) return '0.000'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '0.0%'
  return Number(n).toFixed(1) + '%'
}

function dateDiffDays(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addYears(dateStr, years) {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function qualifyingDispositionDate(offeringStart, purchaseDate) {
  const twoYrFromOffering = addYears(offeringStart, 2)
  const oneYrFromPurchase = addYears(purchaseDate, 1)
  return twoYrFromOffering > oneYrFromPurchase ? twoYrFromOffering : oneYrFromPurchase
}

function isQD(lot) {
  if (!lot.purchaseDate || !lot.offeringStartDate) return false
  const qdDate = qualifyingDispositionDate(lot.offeringStartDate, lot.purchaseDate)
  return todayStr() >= qdDate
}

function purchasePrice(fmvStart, fmvPurchase, discount, lookback) {
  const base = lookback ? Math.min(Number(fmvStart), Number(fmvPurchase)) : Number(fmvPurchase)
  return base * (1 - discount / 100)
}

export default function ESPP() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : DEFAULT_DATA
    } catch { return DEFAULT_DATA }
  })

  const [activeSection, setActiveSection] = useState('plan')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingLot, setEditingLot] = useState(null) // id of lot being edited

  const [lotForm, setLotForm] = useState({
    offeringStartDate: '',
    purchaseDate: '',
    fmvStart: '',
    fmvPurchase: '',
    totalContributions: '',
    saleDate: '',
    salePrice: '',
    notes: '',
  })

  // Persist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    setAppData(CLOUD_KEY, data).catch(console.error)
  }, [data])

  // ── Derived: plan helpers ─────────────────────────────────────────────────
  const { plan, purchases, currentPrice } = data

  const payFreqObj = PAY_FREQS.find(f => f.value === plan.payFrequency) ?? PAY_FREQS[1]
  const annualContribution = Math.min(
    plan.salary * (plan.contributionPct / 100),
    plan.maxContribution,
    25000
  )
  const perPaycheckContrib = annualContribution / payFreqObj.perYear

  // IRS $25,000 rule: tracks FMV at start of offering
  const irsLimitWarning = useMemo(() => {
    if (!plan.offeringStart) return null
    // Estimated FMV at start needed to check; use current price as proxy if no lots
    return annualContribution >= 24000
  }, [annualContribution])

  // ── Offering period tracker ───────────────────────────────────────────────
  const offeringProgress = useMemo(() => {
    if (!plan.offeringStart || !plan.offeringEnd) return null
    const today = todayStr()
    const cycleDays = dateDiffDays(plan.offeringStart, plan.offeringEnd)

    // For recurring plans, find the current cycle's start/end
    let cycleStart = plan.offeringStart
    let cycleEnd   = plan.offeringEnd
    let cycleNumber = 1

    if (plan.recurring && today > plan.offeringEnd) {
      // Advance cycles until we find the one that contains today (or the last one)
      const planEndDate = plan.planEndDate || null
      while (cycleEnd < today) {
        const nextStart = addDays(cycleEnd, 1)
        const nextEnd   = addDays(nextStart, cycleDays)
        if (planEndDate && nextStart > planEndDate) break
        cycleStart = nextStart
        cycleEnd   = nextEnd
        cycleNumber++
      }
    }

    const totalDays = dateDiffDays(cycleStart, cycleEnd)
    const elapsed   = Math.min(Math.max(dateDiffDays(cycleStart, today), 0), totalDays)
    const pct = totalDays > 0 ? (elapsed / totalDays) * 100 : 0

    // Paychecks elapsed in current cycle
    const elapsed_ms = Math.max(0, new Date(today) - new Date(cycleStart))
    const elapsed_days = elapsed_ms / 86400000
    const days_per_paycheck = 365 / payFreqObj.perYear
    const paychecksElapsed = Math.max(0, Math.floor(elapsed_days / days_per_paycheck))
    const contribSoFar = Math.min(paychecksElapsed * perPaycheckContrib, annualContribution)

    const fvmStart = purchases.length > 0 ? purchases[purchases.length - 1].fmvStart : null
    const curPrice = parseFloat(currentPrice) || null

    const estPurchasePrice = (fvmStart && curPrice)
      ? purchasePrice(fvmStart, curPrice, plan.discount, plan.lookback)
      : null

    const estShares = (estPurchasePrice && contribSoFar > 0)
      ? contribSoFar / estPurchasePrice
      : null

    const estGain = (estPurchasePrice && curPrice && estShares)
      ? (curPrice - estPurchasePrice) * estShares
      : null

    const planEnded = plan.planEndDate && today > plan.planEndDate
    const isActive = !planEnded && today >= cycleStart && today <= cycleEnd
    const isPast   = planEnded || (!plan.recurring && today > plan.offeringEnd)

    return {
      totalDays, elapsed, pct, paychecksElapsed,
      contribSoFar, contribRemaining: annualContribution - contribSoFar,
      estPurchasePrice, estShares, estGain, isActive, isPast,
      cycleStart, cycleEnd, cycleNumber, planEnded,
    }
  }, [plan, annualContribution, perPaycheckContrib, purchases, currentPrice])

  // ── Purchase calculator (for new lot form) ───────────────────────────────
  const calcResult = useMemo(() => {
    const fStart = parseFloat(lotForm.fmvStart)
    const fEnd   = parseFloat(lotForm.fmvPurchase)
    const contrib = parseFloat(lotForm.totalContributions)
    if (!fStart || !fEnd || !contrib) return null

    const pp     = purchasePrice(fStart, fEnd, plan.discount, plan.lookback)
    const shares = contrib / pp
    const cost   = contrib
    const fmvVal = shares * fEnd
    const gain   = fmvVal - cost
    const gainPct = (gain / cost) * 100

    return { pp, shares, cost, fmvVal, gain, gainPct }
  }, [lotForm.fmvStart, lotForm.fmvPurchase, lotForm.totalContributions, plan.discount, plan.lookback])

  // ── Tax implications for calc ────────────────────────────────────────────
  const taxCalc = useMemo(() => {
    if (!calcResult || !lotForm.purchaseDate || !lotForm.offeringStartDate) return null
    const { pp, shares, fmvVal, cost } = calcResult
    const fEnd = parseFloat(lotForm.fmvPurchase)
    const fStart = parseFloat(lotForm.fmvStart)
    const today = todayStr()

    const qdDate = qualifyingDispositionDate(lotForm.offeringStartDate, lotForm.purchaseDate)
    const daysUntilQD = dateDiffDays(today, qdDate)
    const alreadyQD = today >= qdDate

    // DD tax (on disposition today)
    const ddSpread = (fEnd - pp) * shares
    const ddOrdinary = ddSpread * (plan.marginalRate / 100)
    const ddLTCG = 0 // assume held < 1yr for DD

    // QD tax (on disposition after holding)
    // Ordinary income = lesser of: (discount applied to lower price × shares) or (sale price - basis)
    // Using fmvStart for the "option price discount" ordinary income component
    const qdOrdinaryComponent = Math.min(
      (fStart * (plan.discount / 100)) * shares,
      Math.max(0, fmvVal - cost)
    )
    const qdOrdinaryTax = qdOrdinaryComponent * (plan.marginalRate / 100)
    const qdCapGain = Math.max(0, fmvVal - cost - qdOrdinaryComponent)
    const qdCapGainTax = qdCapGain * 0.15 // assume 15% LTCG

    return {
      qdDate, daysUntilQD, alreadyQD,
      dd: { ordinary: ddSpread, tax: ddOrdinary },
      qd: { ordinaryComponent: qdOrdinaryComponent, ordinaryTax: qdOrdinaryTax, capGain: qdCapGain, capGainTax: qdCapGainTax },
    }
  }, [calcResult, lotForm.purchaseDate, lotForm.offeringStartDate, plan.marginalRate, plan.discount])

  // ── Purchase history computed ────────────────────────────────────────────
  const lotsWithCalc = useMemo(() => {
    const curPrice = parseFloat(currentPrice) || null
    return purchases.map(lot => {
      const pp    = purchasePrice(lot.fmvStart, lot.fmvPurchase, plan.discount, plan.lookback)
      const shares = lot.totalContributions / pp
      const cost   = lot.totalContributions
      const curVal  = curPrice ? shares * curPrice : null
      const unrealized = curVal != null ? curVal - cost : null
      const qdDate = (lot.offeringStartDate && lot.purchaseDate)
        ? qualifyingDispositionDate(lot.offeringStartDate, lot.purchaseDate)
        : null
      const qualified = qdDate ? (todayStr() >= qdDate) : false
      const today = todayStr()
      const daysUntilQD = qdDate ? dateDiffDays(today, qdDate) : null

      return { ...lot, pp, shares, cost, curVal, unrealized, qdDate, qualified, daysUntilQD }
    })
  }, [purchases, currentPrice, plan.discount, plan.lookback])

  const portfolioTotal = useMemo(() => {
    const curPrice = parseFloat(currentPrice) || null
    if (!curPrice) return null
    return lotsWithCalc.reduce((sum, l) => sum + (l.curVal ?? 0), 0)
  }, [lotsWithCalc, currentPrice])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function updatePlan(field, val) {
    setData(d => ({ ...d, plan: { ...d.plan, [field]: val } }))
  }

  function saveLot() {
    const id = editingLot ?? `lot_${Date.now()}`
    const lot = {
      id,
      offeringStartDate: lotForm.offeringStartDate,
      purchaseDate: lotForm.purchaseDate,
      fmvStart: parseFloat(lotForm.fmvStart) || 0,
      fmvPurchase: parseFloat(lotForm.fmvPurchase) || 0,
      totalContributions: parseFloat(lotForm.totalContributions) || 0,
      saleDate: lotForm.saleDate,
      salePrice: parseFloat(lotForm.salePrice) || 0,
      notes: lotForm.notes,
    }
    setData(d => ({
      ...d,
      purchases: editingLot
        ? d.purchases.map(p => p.id === editingLot ? lot : p)
        : [...d.purchases, lot],
    }))
    setLotForm({ offeringStartDate: '', purchaseDate: '', fmvStart: '', fmvPurchase: '', totalContributions: '', saleDate: '', salePrice: '', notes: '' })
    setShowAddForm(false)
    setEditingLot(null)
  }

  function startEdit(lot) {
    setLotForm({
      offeringStartDate: lot.offeringStartDate,
      purchaseDate: lot.purchaseDate,
      fmvStart: lot.fmvStart,
      fmvPurchase: lot.fmvPurchase,
      totalContributions: lot.totalContributions,
      saleDate: lot.saleDate || '',
      salePrice: lot.salePrice || '',
      notes: lot.notes || '',
    })
    setEditingLot(lot.id)
    setShowAddForm(true)
    setActiveSection('history')
  }

  function deleteLot(id) {
    setData(d => ({ ...d, purchases: d.purchases.filter(p => p.id !== id) }))
  }

  const SECTIONS = [
    { key: 'plan',     label: 'Plan Setup'    },
    { key: 'tracker',  label: 'Offering Period' },
    { key: 'calc',     label: 'Purchase Calc' },
    { key: 'history',  label: 'Purchase History' },
  ]

  return (
    <div className="espp-wrap">
      <div className="espp-header-row">
        <div>
          <h2 className="espp-title">
            ESPP
            {plan.companyName && <span className="espp-company-badge">{plan.companyName}{plan.ticker ? ` · ${plan.ticker.toUpperCase()}` : ''}</span>}
          </h2>
          <p className="espp-subtitle">Employee Stock Purchase Plan</p>
        </div>
        <div className="espp-current-price-row">
          <label className="espp-price-label">Current Stock Price</label>
          <div className="espp-price-input-wrap">
            <span className="espp-price-dollar">$</span>
            <input
              className="espp-price-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={currentPrice}
              onChange={e => setData(d => ({ ...d, currentPrice: e.target.value }))}
            />
          </div>
        </div>
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

      {/* ── Plan Setup ────────────────────────────────────────────────────── */}
      {activeSection === 'plan' && (
        <div className="espp-panel">
          <h3 className="espp-panel-title">Plan Setup</h3>
          <div className="espp-form-grid">
            <div className="espp-field">
              <label>Company Name</label>
              <input value={plan.companyName} onChange={e => updatePlan('companyName', e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="espp-field">
              <label>Ticker Symbol</label>
              <input value={plan.ticker} onChange={e => updatePlan('ticker', e.target.value.toUpperCase())} placeholder="ACME" />
            </div>
            <div className="espp-field">
              <label>Offering Period Start</label>
              <input type="date" value={plan.offeringStart} onChange={e => updatePlan('offeringStart', e.target.value)} />
            </div>
            <div className="espp-field">
              <label>Offering Period End</label>
              <input type="date" value={plan.offeringEnd} onChange={e => updatePlan('offeringEnd', e.target.value)} />
            </div>
            <div className="espp-field espp-field-full">
              <label className="espp-toggle-label">
                <span>Recurring Offering Periods</span>
                <span className="espp-toggle-hint">Offering period repeats automatically with the same duration after each cycle ends</span>
              </label>
              <div className="espp-toggle-wrap">
                <button
                  className={`espp-toggle-btn${plan.recurring ? ' active' : ''}`}
                  onClick={() => updatePlan('recurring', true)}
                >Enabled</button>
                <button
                  className={`espp-toggle-btn${!plan.recurring ? ' active' : ''}`}
                  onClick={() => updatePlan('recurring', false)}
                >Disabled</button>
              </div>
            </div>
            {plan.recurring && (
              <div className="espp-field">
                <label>Plan End Date <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                <input type="date" value={plan.planEndDate || ''} onChange={e => updatePlan('planEndDate', e.target.value)} />
              </div>
            )}
            <div className="espp-field">
              <label>Discount Rate (%)</label>
              <input type="number" min="1" max="15" value={plan.discount} onChange={e => updatePlan('discount', parseFloat(e.target.value) || 15)} />
            </div>
            <div className="espp-field espp-field-full">
              <label className="espp-toggle-label">
                <span>Lookback Provision</span>
                <span className="espp-toggle-hint">Use the lower of start or end price as the basis for discount</span>
              </label>
              <div className="espp-toggle-wrap">
                <button
                  className={`espp-toggle-btn${plan.lookback ? ' active' : ''}`}
                  onClick={() => updatePlan('lookback', true)}
                >Enabled</button>
                <button
                  className={`espp-toggle-btn${!plan.lookback ? ' active' : ''}`}
                  onClick={() => updatePlan('lookback', false)}
                >Disabled</button>
              </div>
            </div>
            <div className="espp-field">
              <label>Annual Salary ($)</label>
              <input type="number" min="0" value={plan.salary} onChange={e => updatePlan('salary', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="espp-field">
              <label>Contribution (%)</label>
              <input type="number" min="1" max="15" value={plan.contributionPct} onChange={e => updatePlan('contributionPct', parseFloat(e.target.value) || 10)} />
            </div>
            <div className="espp-field">
              <label>Pay Frequency</label>
              <select value={plan.payFrequency} onChange={e => updatePlan('payFrequency', e.target.value)}>
                {PAY_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="espp-field">
              <label>Plan Annual Cap ($)</label>
              <input type="number" min="0" value={plan.maxContribution} onChange={e => updatePlan('maxContribution', parseFloat(e.target.value) || 25000)} />
            </div>
            <div className="espp-field">
              <label>Marginal Tax Rate (%)</label>
              <input type="number" min="0" max="60" value={plan.marginalRate} onChange={e => updatePlan('marginalRate', parseFloat(e.target.value) || 22)} />
            </div>
          </div>

          {/* Summary cards */}
          <div className="espp-plan-summary">
            <div className="espp-sum-card">
              <div className="espp-sum-label">Annual Contribution</div>
              <div className="espp-sum-val">{fmt(annualContribution)}</div>
              <div className="espp-sum-sub">{fmtPct(plan.contributionPct)} of salary</div>
            </div>
            <div className="espp-sum-card">
              <div className="espp-sum-label">Per Paycheck</div>
              <div className="espp-sum-val">{fmt(perPaycheckContrib)}</div>
              <div className="espp-sum-sub">{payFreqObj.label}</div>
            </div>
            <div className="espp-sum-card">
              <div className="espp-sum-label">Discount Rate</div>
              <div className="espp-sum-val">{plan.discount}%</div>
              <div className="espp-sum-sub">{plan.lookback ? 'with lookback' : 'no lookback'}</div>
            </div>
            <div className={`espp-sum-card${irsLimitWarning ? ' espp-sum-warning' : ''}`}>
              <div className="espp-sum-label">IRS Annual Limit</div>
              <div className="espp-sum-val">$25,000</div>
              <div className="espp-sum-sub">{irsLimitWarning ? '⚠ Near limit' : 'Under limit'}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Offering Period Tracker ──────────────────────────────────────── */}
      {activeSection === 'tracker' && (
        <div className="espp-panel">
          <h3 className="espp-panel-title">Offering Period Tracker</h3>
          {(!plan.offeringStart || !plan.offeringEnd) ? (
            <p className="espp-empty">Set offering period dates in Plan Setup to see tracking.</p>
          ) : (
            <>
              {plan.recurring && offeringProgress?.cycleNumber > 1 && (
                <div className="espp-cycle-badge">
                  Cycle {offeringProgress.cycleNumber}
                  {plan.planEndDate && <span className="espp-cycle-until"> · plan ends {plan.planEndDate}</span>}
                </div>
              )}

              <div className="espp-tracker-dates">
                <div className="espp-tracker-date-block">
                  <div className="espp-tracker-date-label">{plan.recurring && offeringProgress?.cycleNumber > 1 ? 'Cycle Start' : 'Start'}</div>
                  <div className="espp-tracker-date-val">{offeringProgress?.cycleStart ?? plan.offeringStart}</div>
                </div>
                <div className="espp-tracker-line-wrap">
                  <div className="espp-tracker-line">
                    <div className="espp-tracker-fill" style={{ width: `${offeringProgress?.pct ?? 0}%` }} />
                    <div className="espp-tracker-thumb" style={{ left: `${offeringProgress?.pct ?? 0}%` }} />
                  </div>
                  <div className="espp-tracker-pct">{fmtPct(offeringProgress?.pct ?? 0)} complete</div>
                </div>
                <div className="espp-tracker-date-block espp-tracker-date-end">
                  <div className="espp-tracker-date-label">{plan.recurring && offeringProgress?.cycleNumber > 1 ? 'Cycle End' : 'End'}</div>
                  <div className="espp-tracker-date-val">{offeringProgress?.cycleEnd ?? plan.offeringEnd}</div>
                </div>
              </div>

              <div className="espp-tracker-status">
                {offeringProgress?.planEnded && <span className="espp-status-chip espp-status-past">Plan Ended</span>}
                {!offeringProgress?.planEnded && offeringProgress?.isPast && <span className="espp-status-chip espp-status-past">Period Ended</span>}
                {offeringProgress?.isActive && <span className="espp-status-chip espp-status-active">Active</span>}
                {plan.recurring && !offeringProgress?.planEnded && <span className="espp-status-chip espp-status-recurring">↻ Recurring</span>}
                {!offeringProgress?.isActive && !offeringProgress?.isPast && !offeringProgress?.planEnded && <span className="espp-status-chip espp-status-future">Upcoming</span>}
                <span className="espp-status-days">{offeringProgress?.elapsed} / {offeringProgress?.totalDays} days</span>
              </div>

              <div className="espp-tracker-cards">
                <div className="espp-tracker-card">
                  <div className="espp-tracker-card-label">Contributions So Far</div>
                  <div className="espp-tracker-card-val">{fmt(offeringProgress?.contribSoFar ?? 0)}</div>
                  <div className="espp-tracker-card-sub">{offeringProgress?.paychecksElapsed} paychecks</div>
                </div>
                <div className="espp-tracker-card">
                  <div className="espp-tracker-card-label">Remaining</div>
                  <div className="espp-tracker-card-val">{fmt(Math.max(0, offeringProgress?.contribRemaining ?? 0))}</div>
                  <div className="espp-tracker-card-sub">of {fmt(annualContribution)} annual</div>
                </div>
                <div className="espp-tracker-card">
                  <div className="espp-tracker-card-label">Est. Purchase Price</div>
                  <div className="espp-tracker-card-val">
                    {offeringProgress?.estPurchasePrice ? fmt(offeringProgress.estPurchasePrice) : '—'}
                  </div>
                  <div className="espp-tracker-card-sub">based on current price</div>
                </div>
                <div className="espp-tracker-card">
                  <div className="espp-tracker-card-label">Est. Shares</div>
                  <div className="espp-tracker-card-val">
                    {offeringProgress?.estShares ? fmtShares(offeringProgress.estShares) : '—'}
                  </div>
                  <div className="espp-tracker-card-sub">
                    {offeringProgress?.estGain != null ? `${fmt(offeringProgress.estGain)} est. gain` : 'set current price above'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Purchase Calculator ──────────────────────────────────────────── */}
      {activeSection === 'calc' && (
        <div className="espp-panel">
          <h3 className="espp-panel-title">Purchase Calculator</h3>
          <p className="espp-panel-desc">Enter offering details to estimate shares purchased and tax impact.</p>

          <div className="espp-form-grid">
            <div className="espp-field">
              <label>Offering Start Date</label>
              <input type="date" value={lotForm.offeringStartDate} onChange={e => setLotForm(f => ({ ...f, offeringStartDate: e.target.value }))} />
            </div>
            <div className="espp-field">
              <label>Purchase Date</label>
              <input type="date" value={lotForm.purchaseDate} onChange={e => setLotForm(f => ({ ...f, purchaseDate: e.target.value }))} />
            </div>
            <div className="espp-field">
              <label>FMV at Offering Start ($)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.fmvStart} onChange={e => setLotForm(f => ({ ...f, fmvStart: e.target.value }))} />
            </div>
            <div className="espp-field">
              <label>FMV at Purchase Date ($)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.fmvPurchase} onChange={e => setLotForm(f => ({ ...f, fmvPurchase: e.target.value }))} />
            </div>
            <div className="espp-field">
              <label>Total Contributions ($)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.totalContributions} onChange={e => setLotForm(f => ({ ...f, totalContributions: e.target.value }))} />
            </div>
          </div>

          {calcResult && (
            <>
              <div className="espp-calc-result">
                <div className="espp-calc-row">
                  <span className="espp-calc-label">Purchase Price</span>
                  <span className="espp-calc-val">{fmt(calcResult.pp)}/share</span>
                </div>
                {plan.lookback && (
                  <div className="espp-calc-row espp-calc-sub">
                    <span className="espp-calc-label">Base Price Used</span>
                    <span className="espp-calc-val">
                      {fmt(Math.min(parseFloat(lotForm.fmvStart), parseFloat(lotForm.fmvPurchase)))} (lower of start/end)
                    </span>
                  </div>
                )}
                <div className="espp-calc-row">
                  <span className="espp-calc-label">Shares Purchased</span>
                  <span className="espp-calc-val">{fmtShares(calcResult.shares)} shares</span>
                </div>
                <div className="espp-calc-row">
                  <span className="espp-calc-label">Cost Basis (your cost)</span>
                  <span className="espp-calc-val">{fmt(calcResult.cost)}</span>
                </div>
                <div className="espp-calc-row">
                  <span className="espp-calc-label">FMV on Purchase Date</span>
                  <span className="espp-calc-val">{fmt(calcResult.fmvVal)}</span>
                </div>
                <div className="espp-calc-row espp-calc-gain">
                  <span className="espp-calc-label">Immediate Gain</span>
                  <span className="espp-calc-val espp-green">{fmt(calcResult.gain)} ({fmtPct(calcResult.gainPct)})</span>
                </div>
              </div>

              {taxCalc && (
                <div className="espp-tax-section">
                  <h4 className="espp-tax-title">Tax Implications</h4>

                  <div className="espp-tax-cards">
                    <div className="espp-tax-card espp-tax-dd">
                      <div className="espp-tax-card-header">
                        <span className="espp-tax-badge espp-badge-dd">DD</span>
                        <span>Disqualifying Disposition</span>
                      </div>
                      <p className="espp-tax-card-desc">Selling before the qualifying period ends. The spread at purchase is ordinary income.</p>
                      <div className="espp-tax-row">
                        <span>Ordinary Income (spread)</span>
                        <span>{fmt(taxCalc.dd.ordinary)}</span>
                      </div>
                      <div className="espp-tax-row espp-tax-row-total">
                        <span>Est. Tax at {plan.marginalRate}%</span>
                        <span className="espp-red">{fmt(taxCalc.dd.tax)}</span>
                      </div>
                    </div>

                    <div className="espp-tax-card espp-tax-qd">
                      <div className="espp-tax-card-header">
                        <span className="espp-tax-badge espp-badge-qd">QD</span>
                        <span>Qualifying Disposition</span>
                      </div>
                      <p className="espp-tax-card-desc">
                        Hold until <strong>{taxCalc.qdDate}</strong>
                        {taxCalc.alreadyQD
                          ? ' ✓ (already qualifying)'
                          : ` (${taxCalc.daysUntilQD} more days)`
                        }
                      </p>
                      <div className="espp-tax-row">
                        <span>Ordinary Income Component</span>
                        <span>{fmt(taxCalc.qd.ordinaryComponent)}</span>
                      </div>
                      <div className="espp-tax-row">
                        <span>Ordinary Tax at {plan.marginalRate}%</span>
                        <span>{fmt(taxCalc.qd.ordinaryTax)}</span>
                      </div>
                      <div className="espp-tax-row">
                        <span>Long-Term Capital Gain</span>
                        <span>{fmt(taxCalc.qd.capGain)}</span>
                      </div>
                      <div className="espp-tax-row espp-tax-row-total">
                        <span>Total Est. Tax</span>
                        <span className="espp-red">{fmt(taxCalc.qd.ordinaryTax + taxCalc.qd.capGainTax)}</span>
                      </div>
                    </div>
                  </div>

                  <p className="espp-tax-disclaimer">
                    ⚠ Tax estimates are simplified illustrations. Consult a tax professional for your specific situation. QD ordinary income = lesser of discount on lower price × shares or total gain. LTCG rate assumed at 15%.
                  </p>
                </div>
              )}

              <div className="espp-calc-actions">
                <button className="espp-btn-primary" onClick={() => { setShowAddForm(false); setActiveSection('history'); saveLot() }}>
                  Save to Purchase History
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Purchase History ─────────────────────────────────────────────── */}
      {activeSection === 'history' && (
        <div className="espp-panel">
          <div className="espp-history-header">
            <h3 className="espp-panel-title">Purchase History</h3>
            <button className="espp-btn-primary" onClick={() => { setShowAddForm(s => !s); setEditingLot(null); setLotForm({ offeringStartDate: '', purchaseDate: '', fmvStart: '', fmvPurchase: '', totalContributions: '', saleDate: '', salePrice: '', notes: '' }) }}>
              {showAddForm ? 'Cancel' : '+ Add Lot'}
            </button>
          </div>

          {(showAddForm || editingLot) && (
            <div className="espp-add-form">
              <h4 className="espp-form-title">{editingLot ? 'Edit Lot' : 'Add Purchase Lot'}</h4>
              <div className="espp-form-grid">
                <div className="espp-field">
                  <label>Offering Start Date</label>
                  <input type="date" value={lotForm.offeringStartDate} onChange={e => setLotForm(f => ({ ...f, offeringStartDate: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>Purchase Date</label>
                  <input type="date" value={lotForm.purchaseDate} onChange={e => setLotForm(f => ({ ...f, purchaseDate: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>FMV at Offering Start ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.fmvStart} onChange={e => setLotForm(f => ({ ...f, fmvStart: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>FMV at Purchase Date ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.fmvPurchase} onChange={e => setLotForm(f => ({ ...f, fmvPurchase: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>Total Contributions ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.totalContributions} onChange={e => setLotForm(f => ({ ...f, totalContributions: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>Sale Date (optional)</label>
                  <input type="date" value={lotForm.saleDate} onChange={e => setLotForm(f => ({ ...f, saleDate: e.target.value }))} />
                </div>
                <div className="espp-field">
                  <label>Sale Price/share (optional)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={lotForm.salePrice} onChange={e => setLotForm(f => ({ ...f, salePrice: e.target.value }))} />
                </div>
                <div className="espp-field espp-field-full">
                  <label>Notes</label>
                  <input placeholder="Optional notes" value={lotForm.notes} onChange={e => setLotForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div className="espp-form-actions">
                <button className="espp-btn-primary" onClick={saveLot} disabled={!lotForm.purchaseDate || !lotForm.fmvPurchase || !lotForm.totalContributions}>
                  {editingLot ? 'Save Changes' : 'Add Lot'}
                </button>
                <button className="espp-btn-ghost" onClick={() => { setShowAddForm(false); setEditingLot(null) }}>Cancel</button>
              </div>
            </div>
          )}

          {lotsWithCalc.length === 0 ? (
            <p className="espp-empty">No purchase lots yet. Add lots via the Purchase Calc tab or the button above.</p>
          ) : (
            <>
              {portfolioTotal != null && (
                <div className="espp-portfolio-bar">
                  <span className="espp-portfolio-label">Portfolio Total</span>
                  <span className="espp-portfolio-val">{fmt(portfolioTotal)}</span>
                  <span className="espp-portfolio-sub">at {fmt(parseFloat(currentPrice))}/share</span>
                </div>
              )}

              <div className="espp-lots-table-wrap">
                <table className="espp-lots-table">
                  <thead>
                    <tr>
                      <th>Purchase Date</th>
                      <th>Shares</th>
                      <th>Cost Basis</th>
                      <th>Purchase Price</th>
                      <th>Current Value</th>
                      <th>Unrealized G/L</th>
                      <th>Disposition</th>
                      <th>QD Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotsWithCalc.map(lot => (
                      <tr key={lot.id} className={lot.saleDate ? 'espp-lot-sold' : ''}>
                        <td>{lot.purchaseDate}</td>
                        <td>{fmtShares(lot.shares)}</td>
                        <td>{fmt(lot.cost)}</td>
                        <td>{fmt(lot.pp)}/sh</td>
                        <td>{lot.curVal != null ? fmt(lot.curVal) : '—'}</td>
                        <td className={lot.unrealized != null ? (lot.unrealized >= 0 ? 'espp-green' : 'espp-red') : ''}>
                          {lot.unrealized != null ? fmt(lot.unrealized) : '—'}
                        </td>
                        <td>
                          {lot.qualified
                            ? <span className="espp-chip espp-chip-qd">QD ✓</span>
                            : <span className="espp-chip espp-chip-dd">DD · {lot.daysUntilQD != null && lot.daysUntilQD > 0 ? `${lot.daysUntilQD}d` : 'check'}</span>
                          }
                        </td>
                        <td className="espp-muted">{lot.qdDate ?? '—'}</td>
                        <td>
                          <div className="espp-lot-actions">
                            <button className="espp-lot-btn" onClick={() => startEdit(lot)}>Edit</button>
                            <button className="espp-lot-btn espp-lot-btn-del" onClick={() => deleteLot(lot.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!currentPrice && (
                <p className="espp-empty" style={{ marginTop: 12 }}>Set the current stock price at the top to see current values and unrealized gains.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
