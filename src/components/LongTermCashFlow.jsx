import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'

const LTCF_KEY        = 'longterm_cashflow_settings'
const BONUS_MODE_KEY  = 'cashflow_bonus_mode'
const BONUS_MONTH_KEY = 'cashflow_bonus_month'
const BILLS_KEY       = 'finance_bills'
const BALANCES_KEY    = 'cashflow_balances'
const ESPP_KEY        = 'espp_data'
const BUDGET_KEY      = 'finance_budget'
const EQUITY_KEY      = 'finance_equity'
const RENTALS_KEY     = 'finance_rentals'

const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const HORIZONS = [
  { label: '1 Year',   value: 1  },
  { label: '2 Years',  value: 2  },
  { label: '3 Years',  value: 3  },
  { label: '5 Years',  value: 5  },
  { label: '10 Years', value: 10 },
]

const DEFAULT_SETTINGS = {
  horizon:           5,
  startBalance:      0,
  monthlyIncome:     0,
  monthlyExpenses:   0,
  incomeGrowthRate:  3,
  expenseGrowthRate: 2,
  bonusAmount:       0,
  bonusMonth:        3,
  bonusMode:         'lump_sum',
}

// ── Helpers ────────────────────────────────────────────────

function readStartBalance() {
  try {
    const s = localStorage.getItem(BALANCES_KEY)
    return s ? (JSON.parse(s).begin || 0) : 0
  } catch { return 0 }
}

function readBills() {
  try {
    const s = localStorage.getItem(BILLS_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed
    }
    return []
  } catch { return [] }
}

function readEsppData() {
  try {
    const s = localStorage.getItem(ESPP_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function readBudgetData() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function readEquityData() {
  try {
    const s = localStorage.getItem(EQUITY_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function readRentalsData() {
  try {
    const s = localStorage.getItem(RENTALS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

// Returns per-property net cash flow for month `i` (0-based from projection start).
// Applies vacancy rate and stops mortgage payment after mortgageTermMonths.
function rentalNetForMonth(p, monthIndex) {
  const exp =
    (p.expenses?.taxes       || 0) +
    (p.expenses?.insurance   || 0) +
    (p.expenses?.hoa         || 0) +
    (p.expenses?.maintenance || 0) +
    (p.expenses?.other       || 0)

  // Vacancy: occupied properties lose vacancyRate% of rent
  const effectiveRent = p.occupied
    ? (p.monthlyRent || 0) * (1 - (p.vacancyRate || 0) / 100)
    : 0

  // Stop mortgage payment after term expires
  const mortgageActive = !p.mortgageTermMonths || monthIndex < (p.mortgageTermMonths || 0)
  const mortgagePmt = mortgageActive ? (p.mortgagePayment || 0) : 0

  return effectiveRent - mortgagePmt - exp
}

// Returns total RSU vest value (at current price) for events falling in the 12 months
// after today — informational only, not included in projection math.
function upcomingRsuVestValue(grants) {
  if (!grants?.length) return 0
  const today   = new Date().toISOString().slice(0, 10)
  const cutoff  = new Date(); cutoff.setMonth(cutoff.getMonth() + 12)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  let total = 0
  const freqMap = { monthly: 1, quarterly: 3, annual: 12 }
  grants.forEach(g => {
    if (g.type !== 'rsu') return
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

// Returns monthly expense reduction for budget entries whose end date has passed by dateStr.
// Uses billToMonthly for frequency conversion (same logic, already defined below).
function endedBudgetExpenses(budget, dateStr) {
  if (!budget) return 0
  const allExpenses = [...(budget.fixedExpenses || []), ...(budget.discretionary || [])]
  return allExpenses
    .filter(r => r.endDate && dateStr > r.endDate)
    .reduce((sum, r) => sum + billToMonthly(r.amount, r.frequency), 0)
}

// Returns monthly ESPP contribution if the date falls within an active offering period, else 0.
// Handles recurring plans (period repeats indefinitely or until planEndDate).
function esppMonthlyForDate(plan, dateStr) {
  if (!plan || !plan.offeringStart || !plan.offeringEnd) return 0
  if (dateStr < plan.offeringStart) return 0
  if (plan.recurring) {
    if (plan.planEndDate && dateStr > plan.planEndDate) return 0
    // Recurring: active any time on or after offeringStart (within planEndDate)
  } else {
    if (dateStr > plan.offeringEnd) return 0
  }
  const annual = Math.min(
    (plan.salary || 0) * ((plan.contributionPct || 0) / 100),
    plan.maxContribution || 25000,
    25000,
  )
  return annual / 12
}

function billToMonthly(amount, frequency) {
  switch (frequency) {
    case 'Weekly':    return amount * 52 / 12
    case 'Bi-weekly': return amount * 26 / 12
    case 'Monthly':   return amount
    case 'Quarterly': return amount / 3
    case 'Annual':    return amount / 12
    default:          return amount
  }
}

// Returns monthly expense reduction for recurring transactions that have ended by dateStr
function endedRecurringExpenses(transactions, dateStr) {
  if (!transactions?.length) return 0
  return transactions
    .filter(tx => tx.type === 'expense' && tx.recurring && tx.endDate && dateStr > tx.endDate)
    .reduce((sum, tx) => sum + billToMonthly(tx.amount, tx.frequency || 'Monthly'), 0)
}

function computeAvgLast3Months(transactions) {
  if (!transactions.length) return { avgIncome: 0, avgExpenses: 0 }
  const map = {}
  transactions.forEach(tx => {
    const d   = new Date(tx.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!map[key]) map[key] = { income: 0, expenses: 0 }
    if (tx.type === 'income')  map[key].income   += tx.amount
    if (tx.type === 'expense') map[key].expenses += tx.amount
  })
  const last3 = Object.entries(map)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
  if (!last3.length) return { avgIncome: 0, avgExpenses: 0 }
  const avgIncome   = last3.reduce((s, [, v]) => s + v.income,   0) / last3.length
  const avgExpenses = last3.reduce((s, [, v]) => s + v.expenses, 0) / last3.length
  return { avgIncome, avgExpenses }
}

function loadSettings(transactions) {
  try {
    const s = localStorage.getItem(LTCF_KEY)
    if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) }
  } catch {}
  // First visit — auto-fill from other saved data + transaction averages
  const { avgIncome, avgExpenses } = computeAvgLast3Months(transactions)
  return {
    ...DEFAULT_SETTINGS,
    startBalance:    readStartBalance(),
    monthlyIncome:   Math.round(avgIncome),
    monthlyExpenses: Math.round(avgExpenses),
    bonusMode:       localStorage.getItem(BONUS_MODE_KEY)  || 'lump_sum',
    bonusMonth:      parseInt(localStorage.getItem(BONUS_MONTH_KEY)) || 3,
  }
}

function fmt(n) {
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ── Component ──────────────────────────────────────────────

export default function LongTermCashFlow({ transactions, spendingMode }) {
  const [settings,     setSettings]     = useState(() => loadSettings(transactions))
  const [showSettings, setShowSettings] = useState(false)

  // Persist to localStorage + Supabase whenever settings change
  useEffect(() => {
    localStorage.setItem(LTCF_KEY, JSON.stringify(settings))
    setAppData('longterm_cashflow_settings', settings).catch(console.error)
  }, [settings])

  function set(key, val) {
    setSettings(p => ({ ...p, [key]: val }))
  }

  // ── Build monthly projection ───────────────────────────
  const rows = useMemo(() => {
    const totalMonths = settings.horizon * 12
    const now         = new Date()
    // Start from the first day of next month
    const startDate   = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    // Fresh read of active bills, ESPP, budget, and rentals each recalculation
    const activeBills = readBills().filter(b => b.active)

    const esppData   = readEsppData()
    const esppPlan   = esppData?.plan ?? null
    const budgetData = readBudgetData()
    const rentals    = readRentalsData()

    let balance = settings.startBalance
    const result = []

    for (let i = 0; i < totalMonths; i++) {
      const d             = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
      const yearIndex     = Math.floor(i / 12)   // 0-based year of projection
      const calendarMonth = d.getMonth() + 1      // 1–12
      const dateStr       = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

      // Growth compounds annually (step function at each year boundary)
      const incMult  = Math.pow(1 + settings.incomeGrowthRate  / 100, yearIndex)
      const expMult  = Math.pow(1 + settings.expenseGrowthRate / 100, yearIndex)

      const baseIncome   = settings.monthlyIncome * incMult
      // Bills that are still active this month (respect per-bill end dates)
      const billsThisMonth = activeBills
        .filter(b => !b.endDate || dateStr <= b.endDate)
        .reduce((sum, b) => sum + billToMonthly(b.amount, b.frequency), 0)
      // Simple mode: use the global discretionary lump sum; Detailed: use manually-entered amount
      const effectiveDiscretionary = spendingMode?.mode === 'simple'
        ? (spendingMode?.monthly || 0)
        : settings.monthlyExpenses
      const baseExpenses = (effectiveDiscretionary + billsThisMonth) * expMult

      // Bonus income
      let bonusIncome = 0
      if (settings.bonusAmount > 0) {
        if (settings.bonusMode === 'spread') {
          bonusIncome = settings.bonusAmount / 12
        } else if (calendarMonth === settings.bonusMonth) {
          bonusIncome = settings.bonusAmount
        }
      }

      // ESPP contributions — only during the offering period; do not grow with inflation
      const esppContrib = esppMonthlyForDate(esppPlan, dateStr)

      // Recurring transaction expenses that have ended — reduce projected spending
      const recurringEnded = endedRecurringExpenses(transactions, dateStr)
      // Budget planner expenses whose end date has passed — reduce projected spending
      const budgetEnded    = endedBudgetExpenses(budgetData, dateStr)

      // Rental net cash flow for this month
      const rentalNCF = rentals.reduce((s, p) => s + rentalNetForMonth(p, i), 0)

      const totalIncome   = +(baseIncome + bonusIncome + Math.max(0, rentalNCF)).toFixed(2)
      const rentalDrain   = Math.min(0, rentalNCF)  // negative NCF adds to expenses
      const totalExpenses = +(baseExpenses + esppContrib - recurringEnded - budgetEnded - rentalDrain).toFixed(2)
      const net           = +(totalIncome - totalExpenses).toFixed(2)
      const beginBal      = +balance.toFixed(2)
      const endBal        = +(beginBal + net).toFixed(2)
      balance = endBal

      result.push({
        i,
        label:      `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`,
        beginBal,
        income:     totalIncome,
        expenses:   totalExpenses,
        bonus:      +bonusIncome.toFixed(2),
        esppContrib: +esppContrib.toFixed(2),
        net,
        endBal,
        yearIndex,
      })
    }
    return result
  }, [settings, transactions, spendingMode])

  // ── Summary stats ──────────────────────────────────────
  const summary = useMemo(() => {
    if (!rows.length) return null
    const finalBal      = rows[rows.length - 1].endBal
    const totalIncome   = rows.reduce((s, r) => s + r.income,   0)
    const totalExpenses = rows.reduce((s, r) => s + r.expenses, 0)
    const negativeMonths = rows.filter(r => r.net < 0).length
    const bestRow   = rows.reduce((a, b) => b.net > a.net ? b : a, rows[0])
    const worstRow  = rows.reduce((a, b) => b.net < a.net ? b : a, rows[0])
    const netGain   = finalBal - settings.startBalance
    return { finalBal, totalIncome, totalExpenses, negativeMonths, bestRow, worstRow, netGain }
  }, [rows, settings.startBalance])

  function rowClass(row) {
    if (row.net >  50)  return 'lt-row-green'
    if (row.net < -50)  return 'lt-row-red'
    return 'lt-row-yellow'
  }

  const showBonus = settings.bonusAmount > 0
  const showEspp  = rows.some(r => r.esppContrib > 0)

  return (
    <div className="rc-page">

      {/* ── Settings / controls card ──────────────────── */}
      <div className="card rc-card">
        <div className="rc-card-head">
          <div>
            <h2>Long-Term Cash Flow</h2>
            {!showSettings && (
              <p className="bp-subtitle" style={{ marginBottom: 0 }}>
                {settings.horizon}-year projection · {rows.length} months
              </p>
            )}
          </div>
          <button
            className="bills-btn-primary"
            onClick={() => setShowSettings(p => !p)}
          >
            {showSettings ? '✕ Close' : '⚙ Settings'}
          </button>
        </div>

        {/* Horizon selector — always visible */}
        <div className="lt-horizon-row">
          <span className="rc-label">Time Horizon</span>
          <div className="lt-horizon-opts">
            {HORIZONS.map(h => (
              <button
                key={h.value}
                className={`cf-bonus-btn ${settings.horizon === h.value ? 'active' : ''}`}
                onClick={() => set('horizon', h.value)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {/* Expandable settings panel */}
        {showSettings && (
          <div className="lt-settings-panel">
            <div className="lt-settings-section-label">Starting Point</div>
            <div className="lt-settings-grid">
              <div className="rc-field">
                <label className="rc-label">Starting Balance</label>
                <span className="rc-hint">From Cash Flow page</span>
                <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                  <span className="nw-prefix">$</span>
                  <input className="nw-num-input" type="number" min="0" step="100"
                    style={{ width: '110px' }} value={settings.startBalance || ''}
                    placeholder="0"
                    onChange={e => set('startBalance', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Monthly Income</label>
                <span className="rc-hint">Avg of last 3 months</span>
                <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                  <span className="nw-prefix">$</span>
                  <input className="nw-num-input" type="number" min="0" step="100"
                    style={{ width: '110px' }} value={settings.monthlyIncome || ''}
                    placeholder="0"
                    onChange={e => set('monthlyIncome', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Monthly Discretionary</label>
                {spendingMode?.mode === 'simple' ? (
                  <>
                    <span className="rc-hint">Controlled by Spending Mode</span>
                    <div className="lt-mode-locked">
                      ${(spendingMode?.monthly || 0).toLocaleString()}/mo
                    </div>
                  </>
                ) : (
                  <>
                    <span className="rc-hint">Avg of last 3 months</span>
                    <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                      <span className="nw-prefix">$</span>
                      <input className="nw-num-input" type="number" min="0" step="100"
                        style={{ width: '110px' }} value={settings.monthlyExpenses || ''}
                        placeholder="0"
                        onChange={e => set('monthlyExpenses', parseFloat(e.target.value) || 0)} />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="lt-settings-section-label" style={{ marginTop: '16px' }}>Growth Rates</div>
            <div className="lt-settings-grid">
              <div className="rc-field">
                <label className="rc-label">Income Growth</label>
                <span className="rc-hint">% per year (e.g. 3% raise)</span>
                <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                  <input className="nw-num-input" type="number" min="0" max="50" step="0.5"
                    style={{ width: '60px' }} value={settings.incomeGrowthRate}
                    onChange={e => set('incomeGrowthRate', parseFloat(e.target.value) || 0)} />
                  <span className="nw-suffix">%/yr</span>
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Expense Growth</label>
                <span className="rc-hint">% per year (inflation)</span>
                <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                  <input className="nw-num-input" type="number" min="0" max="50" step="0.5"
                    style={{ width: '60px' }} value={settings.expenseGrowthRate}
                    onChange={e => set('expenseGrowthRate', parseFloat(e.target.value) || 0)} />
                  <span className="nw-suffix">%/yr</span>
                </div>
              </div>
            </div>

            <div className="lt-settings-section-label" style={{ marginTop: '16px' }}>Bonus</div>
            <div className="lt-settings-grid">
              <div className="rc-field">
                <label className="rc-label">Annual Bonus</label>
                <div className="nw-num-wrap" style={{ marginTop: '4px' }}>
                  <span className="nw-prefix">$</span>
                  <input className="nw-num-input" type="number" min="0" step="500"
                    style={{ width: '100px' }} value={settings.bonusAmount || ''}
                    placeholder="0"
                    onChange={e => set('bonusAmount', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Bonus Month</label>
                <select className="bills-select" style={{ marginTop: '4px', width: 'auto' }}
                  value={settings.bonusMonth}
                  onChange={e => set('bonusMonth', parseInt(e.target.value))}>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>

              <div className="rc-field">
                <label className="rc-label">Bonus Distribution</label>
                <div className="cf-bonus-options" style={{ marginTop: '6px' }}>
                  <button
                    className={`cf-bonus-btn ${settings.bonusMode === 'lump_sum' ? 'active' : ''}`}
                    onClick={() => set('bonusMode', 'lump_sum')}
                  >
                    Lump Sum
                  </button>
                  <button
                    className={`cf-bonus-btn ${settings.bonusMode === 'spread' ? 'active' : ''}`}
                    onClick={() => set('bonusMode', 'spread')}
                  >
                    Spread
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bills info strip — always visible */}
        {(() => {
          const today = new Date().toISOString().slice(0, 10)
          const bm = readBills()
            .filter(b => b.active && (!b.endDate || today <= b.endDate))
            .reduce((s, b) => s + billToMonthly(b.amount, b.frequency), 0)
          return bm > 0 ? (
            <div className="lt-bills-strip">
              <span>📋 Recurring bills: <strong>{fmt(bm)}/mo</strong></span>
              <span className="lt-bills-note">included in expenses, growing with inflation rate, end dates respected per month</span>
            </div>
          ) : null
        })()}

        {/* Recurring transactions strip */}
        {(() => {
          const recurring = (transactions || []).filter(tx => tx.type === 'expense' && tx.recurring)
          if (!recurring.length) return null
          const today    = new Date().toISOString().slice(0, 10)
          const active   = recurring.filter(tx => !tx.endDate || today <= tx.endDate)
          const expiring = recurring.filter(tx => tx.endDate && today <= tx.endDate)
          return (
            <div className="lt-bills-strip" style={{ borderColor: '#a5b4fc', background: '#eef2ff' }}>
              <span>🔁 Recurring expenses tracked: <strong>{active.length}</strong> active{expiring.length > 0 ? `, ${expiring.length} with end date` : ''}</span>
              <span className="lt-bills-note">removed from projection after their end date</span>
            </div>
          )
        })()}

        {/* Budget planner expenses with end dates strip */}
        {(() => {
          const budget   = readBudgetData()
          const allExp   = [...(budget?.fixedExpenses || []), ...(budget?.discretionary || [])]
          const withEnd  = allExp.filter(r => r.endDate)
          if (!withEnd.length) return null
          const today    = new Date().toISOString().slice(0, 10)
          const active   = withEnd.filter(r => today <= r.endDate)
          const expired  = withEnd.length - active.length
          return (
            <div className="lt-bills-strip" style={{ borderColor: '#fcd34d', background: '#fffbeb' }}>
              <span>📊 Budget expenses with end dates: <strong>{active.length}</strong> active{expired > 0 ? `, ${expired} expired` : ''}</span>
              <span className="lt-bills-note">removed from forecast after end date</span>
            </div>
          )
        })()}

        {/* Equity RSU vesting strip */}
        {(() => {
          const grants    = readEquityData()
          const rsuGrants = grants.filter(g => g.type === 'rsu' && parseFloat(g.currentPrice) > 0)
          if (!rsuGrants.length) return null
          const upcoming = upcomingRsuVestValue(rsuGrants)
          if (upcoming <= 0) return null
          const names = [...new Set(rsuGrants.map(g => g.companyName || g.ticker).filter(Boolean))]
          return (
            <div className="lt-bills-strip" style={{ borderColor: '#34d399', background: '#ecfdf5' }}>
              <span>
                🏷 RSU vesting (next 12 mo){names.length > 0 ? ` · ${names.join(', ')}` : ''}:{' '}
                <strong>{fmt(upcoming)}</strong>
              </span>
              <span className="lt-bills-note">informational only — not included in projection</span>
            </div>
          )
        })()}

        {/* ESPP contributions strip — visible when offering period overlaps projection */}
        {(() => {
          const espp = readEsppData()
          if (!espp?.plan?.offeringStart || !espp?.plan?.offeringEnd) return null
          const monthly = esppMonthlyForDate(espp.plan, espp.plan.offeringStart)
          if (!monthly) return null
          const companyLabel = espp.plan.companyName
            ? ` (${espp.plan.companyName}${espp.plan.ticker ? ' · ' + espp.plan.ticker.toUpperCase() : ''})`
            : ''
          const noteText = espp.plan.recurring
            ? `recurring from ${espp.plan.offeringStart}${espp.plan.planEndDate ? ' until ' + espp.plan.planEndDate : ', no end date set'}`
            : `during offering period ${espp.plan.offeringStart} → ${espp.plan.offeringEnd}, $0 outside`
          return (
            <div className="lt-bills-strip" style={{ borderColor: '#c4b5fd', background: '#f5f3ff' }}>
              <span>📈 ESPP{espp.plan.recurring ? ' ↻' : ''}{companyLabel}: <strong>{fmt(monthly)}/mo</strong></span>
              <span className="lt-bills-note">{noteText}</span>
            </div>
          )
        })()}

        {/* Rental properties strip */}
        {(() => {
          const rentals = readRentalsData()
          if (!rentals.length) return null
          const totalNCF = rentals.reduce((s, p) => s + rentalNetForMonth(p, 0), 0)
          const occupied = rentals.filter(p => p.occupied).length
          return (
            <div className="lt-bills-strip" style={{ borderColor: '#93c5fd', background: '#eff6ff' }}>
              <span>
                🏠 Rentals ({rentals.length} propert{rentals.length !== 1 ? 'ies' : 'y'}, {occupied} occupied):{' '}
                <strong style={{ color: totalNCF >= 0 ? '#059669' : '#dc2626' }}>
                  {totalNCF >= 0 ? '+' : ''}{fmt(totalNCF)}/mo
                </strong>
              </span>
              <span className="lt-bills-note">included in projection · mortgage stops after term ends</span>
            </div>
          )
        })()}
      </div>

      {/* ── Summary row ──────────────────────────────── */}
      {summary && (
        <div className="lt-summary-row">
          <div className="card lt-summary-card lt-summary-highlight">
            <span className="lt-summary-label">Projected Balance</span>
            <strong className="lt-summary-big"
              style={{ color: summary.finalBal >= settings.startBalance ? '#10b981' : '#ef4444' }}>
              {fmt(summary.finalBal)}
            </strong>
            <span className="lt-summary-sub">after {settings.horizon} yr{settings.horizon > 1 ? 's' : ''}</span>
          </div>

          <div className="card lt-summary-card">
            <span className="lt-summary-label">Net Gain / Loss</span>
            <strong className="lt-summary-big"
              style={{ color: summary.netGain >= 0 ? '#10b981' : '#ef4444' }}>
              {summary.netGain >= 0 ? '+' : ''}{fmt(summary.netGain)}
            </strong>
            <span className="lt-summary-sub">vs. starting balance</span>
          </div>

          <div className="card lt-summary-card">
            <span className="lt-summary-label">Total Income</span>
            <strong className="lt-summary-big" style={{ color: '#10b981' }}>
              {fmt(summary.totalIncome)}
            </strong>
            <span className="lt-summary-sub">over {rows.length} months</span>
          </div>

          <div className="card lt-summary-card">
            <span className="lt-summary-label">Total Expenses</span>
            <strong className="lt-summary-big" style={{ color: '#ef4444' }}>
              {fmt(summary.totalExpenses)}
            </strong>
            <span className="lt-summary-sub">over {rows.length} months</span>
          </div>

          <div className="card lt-summary-card">
            <span className="lt-summary-label">Best Month</span>
            <strong className="lt-summary-big" style={{ color: '#10b981' }}>
              +{fmt(summary.bestRow.net)}
            </strong>
            <span className="lt-summary-sub">{summary.bestRow.label}</span>
          </div>

          <div className="card lt-summary-card">
            <span className="lt-summary-label">Worst Month</span>
            <strong className="lt-summary-big"
              style={{ color: summary.worstRow.net < 0 ? '#ef4444' : '#10b981' }}>
              {summary.worstRow.net >= 0 ? '+' : ''}{fmt(summary.worstRow.net)}
            </strong>
            <span className="lt-summary-sub">{summary.worstRow.label}</span>
          </div>

          {summary.negativeMonths > 0 && (
            <div className="card lt-summary-card lt-summary-warning">
              <span className="lt-summary-label">Negative Months</span>
              <strong className="lt-summary-big" style={{ color: '#ef4444' }}>
                {summary.negativeMonths}
              </strong>
              <span className="lt-summary-sub">months with cash deficit</span>
            </div>
          )}
        </div>
      )}

      {/* ── Monthly projection table ──────────────────── */}
      <div className="card rc-card">
        <div className="rc-card-head" style={{ marginBottom: '0' }}>
          <h2>Monthly Projection</h2>
          <div className="lt-legend">
            <span className="lt-legend-dot lt-legend-green" />positive
            <span className="lt-legend-dot lt-legend-yellow" style={{ marginLeft: '10px' }} />flat
            <span className="lt-legend-dot lt-legend-red"   style={{ marginLeft: '10px' }} />deficit
          </div>
        </div>

        <div className="cf-table-wrap lt-table-wrap">
          <table className="cf-table lt-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Beg. Balance</th>
                <th>Income</th>
                {showBonus && <th>Bonus</th>}
                {showEspp  && <th>ESPP</th>}
                <th>Expenses</th>
                <th>Net</th>
                <th>End Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.i} className={rowClass(row)}>
                  <td className="cf-month-label">
                    {row.label}
                    {row.i > 0 && row.i % 12 === 0 && (
                      <span className="lt-year-badge">Yr {row.yearIndex + 1}</span>
                    )}
                  </td>
                  <td className="cf-bal">{fmt(row.beginBal)}</td>
                  <td className="cf-income">{fmt(row.income)}</td>
                  {showBonus && (
                    <td className={row.bonus > 0 ? 'lt-bonus-cell' : 'lt-no-bonus-cell'}>
                      {row.bonus > 0 ? `+${fmt(row.bonus)}` : '—'}
                    </td>
                  )}
                  {showEspp && (
                    <td className={row.esppContrib > 0 ? 'cf-expense' : 'lt-no-bonus-cell'}>
                      {row.esppContrib > 0 ? fmt(row.esppContrib) : '—'}
                    </td>
                  )}
                  <td className="cf-expense">{fmt(row.expenses)}</td>
                  <td className={row.net >= 0 ? 'cf-pos' : 'cf-neg'}>
                    {row.net >= 0 ? '+' : ''}{fmt(row.net)}
                  </td>
                  <td className={`cf-bal ${row.endBal >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                    {fmt(row.endBal)}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="cf-table-total">
                  <td>Final ({settings.horizon} yr{settings.horizon > 1 ? 's' : ''})</td>
                  <td className="cf-bal">{fmt(settings.startBalance)}</td>
                  <td className="cf-income">{summary ? fmt(summary.totalIncome) : '—'}</td>
                  {showBonus && <td></td>}
                  {showEspp  && <td></td>}
                  <td className="cf-expense">{summary ? fmt(summary.totalExpenses) : '—'}</td>
                  <td className={summary && summary.netGain >= 0 ? 'cf-pos' : 'cf-neg'}>
                    {summary ? `${summary.netGain >= 0 ? '+' : ''}${fmt(summary.netGain)}` : '—'}
                  </td>
                  <td className={`cf-bal ${summary && summary.finalBal >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                    {summary ? fmt(summary.finalBal) : '—'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  )
}
