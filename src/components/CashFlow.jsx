import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { setAppData } from '../lib/db'

const BUDGET_KEY      = 'finance_budget'
const LOANS_KEY       = 'finance_loans'
const BALANCES_KEY    = 'cashflow_balances'
const BONUS_MODE_KEY  = 'cashflow_bonus_mode'
const BONUS_MONTH_KEY = 'cashflow_bonus_month'
const ESPP_KEY        = 'espp_data'
const RENTALS_KEY     = 'finance_rentals'

const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Average working days per month (260 trading days / 12)
const AVG_WORK_DAYS = 260 / 12

const DEFAULT_BALANCES = { begin: 0, endOverride: false, endAmount: 0 }

function loadBalances() {
  try {
    const s = localStorage.getItem(BALANCES_KEY)
    if (s) return { ...DEFAULT_BALANCES, ...JSON.parse(s) }
    return DEFAULT_BALANCES
  } catch { return DEFAULT_BALANCES }
}

function fmtFull(n) {
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function readBudget() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function readLoans() {
  try {
    const s = localStorage.getItem(LOANS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function readEsppData() {
  try {
    const s = localStorage.getItem(ESPP_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function readRentals() {
  try {
    const s = localStorage.getItem(RENTALS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

function calcRentalMonthly(rentals) {
  if (!rentals?.length) return { rentalIncome: 0, rentalExpenses: 0 }
  let rentalIncome   = 0
  let rentalExpenses = 0
  rentals.forEach(p => {
    if (p.occupied) rentalIncome += (p.monthlyRent || 0) * (1 - (p.vacancyRate || 0) / 100)
    const exp =
      (p.expenses?.taxes       || 0) +
      (p.expenses?.insurance   || 0) +
      (p.expenses?.hoa         || 0) +
      (p.expenses?.maintenance || 0) +
      (p.expenses?.other       || 0) +
      (p.mortgagePayment       || 0)
    rentalExpenses += exp
  })
  return { rentalIncome: +rentalIncome.toFixed(2), rentalExpenses: +rentalExpenses.toFixed(2) }
}

// Returns the monthly ESPP contribution for a given month (YYYY-MM-DD string).
// Returns 0 if no plan configured, plan has no offering dates, or the month
// falls outside the offering period. Handles recurring plans.
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

function loanMonthlyPayment(loan) {
  const { balance, annualRate, termMonths } = loan
  if (!termMonths || balance <= 0) return 0
  if (annualRate === 0) return balance / termMonths
  const r = annualRate / 100 / 12
  return balance * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
}

// Full take-home including bonus/12 — used for Spread Evenly mode
function earnerTakeHome(earnerData) {
  if (!earnerData) return 0
  if ('baseSalary' in earnerData) {
    const gross = (earnerData.baseSalary || 0) / 260 * AVG_WORK_DAYS
      + (earnerData.bonusTarget  || 0) / 12
      + (earnerData.equityTarget || 0) / 12
    const preTax = (earnerData.retirement401k  || 0)
      + (earnerData.healthInsurance || 0)
      + (earnerData.hsa            || 0)
      + (earnerData.otherPreTax    || 0)
    const taxable = Math.max(0, gross - preTax)
    const fed   = taxable * (earnerData.federalTaxRate || 0) / 100
    const state = taxable * (earnerData.stateTaxRate   || 0) / 100
    const fica  = gross * 0.0765
    return gross - fed - state - fica - preTax - (earnerData.otherPostTax || 0)
  }
  const { grossIncome = 0, taxes = 0, retirementSavings = 0, otherSavings = 0 } = earnerData
  return grossIncome - taxes - retirementSavings - otherSavings
}

// Monthly take-home WITHOUT bonus — used as base for Lump Sum mode
function earnerTakeHomeBase(earnerData) {
  if (!earnerData) return 0
  if ('baseSalary' in earnerData) {
    const gross = (earnerData.baseSalary || 0) / 260 * AVG_WORK_DAYS
      + (earnerData.equityTarget || 0) / 12   // no bonusTarget
    const preTax = (earnerData.retirement401k  || 0)
      + (earnerData.healthInsurance || 0)
      + (earnerData.hsa            || 0)
      + (earnerData.otherPreTax    || 0)
    const taxable = Math.max(0, gross - preTax)
    const fed   = taxable * (earnerData.federalTaxRate || 0) / 100
    const state = taxable * (earnerData.stateTaxRate   || 0) / 100
    const fica  = gross * 0.0765
    return gross - fed - state - fica - preTax - (earnerData.otherPostTax || 0)
  }
  // Legacy format — bonus not separable, return full amount unchanged
  const { grossIncome = 0, taxes = 0, retirementSavings = 0, otherSavings = 0 } = earnerData
  return grossIncome - taxes - retirementSavings - otherSavings
}

// Annual gross bonus from the budget planner (used for lump sum projection)
function earnerBonusAnnual(earnerData) {
  if (!earnerData || !('baseSalary' in earnerData)) return 0
  return earnerData.bonusTarget || 0
}

function earnerSavings(earnerData) {
  if (!earnerData) return 0
  if ('baseSalary' in earnerData) {
    return (earnerData.retirement401k || 0)
      + (earnerData.hsa           || 0)
      + (earnerData.otherPreTax   || 0)
      + (earnerData.otherPostTax  || 0)
  }
  const { retirementSavings = 0, otherSavings = 0 } = earnerData
  return retirementSavings + otherSavings
}

export default function CashFlow({ transactions, earnerView, household, spendingMode }) {
  const [balances,   setBalances]   = useState(loadBalances)
  const [bonusMode,  setBonusMode]  = useState(() => localStorage.getItem(BONUS_MODE_KEY)  || 'lump_sum')
  const [bonusMonth, setBonusMonth] = useState(() => parseInt(localStorage.getItem(BONUS_MONTH_KEY)) || 3)

  useEffect(() => {
    localStorage.setItem(BALANCES_KEY, JSON.stringify(balances))
    setAppData('cashflow_balances', balances).catch(console.error)
  }, [balances])

  useEffect(() => { localStorage.setItem(BONUS_MODE_KEY, bonusMode)           }, [bonusMode])
  useEffect(() => { localStorage.setItem(BONUS_MONTH_KEY, String(bonusMonth)) }, [bonusMonth])

  function setBalance(key, val) {
    setBalances(p => ({ ...p, [key]: val }))
  }

  // ── Historical ──────────────────────────────────────────
  const historicalData = useMemo(() => {
    const txs = earnerView === 'combined'
      ? transactions
      : transactions.filter(tx => !tx.earner || tx.earner === 'joint' || tx.earner === earnerView)

    const map         = {}
    const bonusByYear = {}   // year → total bonus amount (lump sum mode)
    let   totalBonus  = 0    // all-time bonus total (spread mode)

    txs.forEach(tx => {
      const d    = new Date(tx.date)
      const year = d.getFullYear()
      const key  = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map[key]) map[key] = { key, year, month: d.getMonth(), income: 0, expenses: 0 }

      if (tx.type === 'income' && tx.category === 'Bonus') {
        if (bonusMode === 'spread') {
          // Pull bonus out of its actual month; will distribute evenly below
          totalBonus += tx.amount
        } else {
          // Lump sum: accumulate by year, will land in the selected bonus month
          bonusByYear[year] = (bonusByYear[year] || 0) + tx.amount
        }
      } else {
        if (tx.type === 'income')  map[key].income   += tx.amount
        if (tx.type === 'expense') map[key].expenses += tx.amount
      }
    })

    // Lump sum: redirect each year's bonus into the selected month of that year
    if (bonusMode === 'lump_sum') {
      Object.entries(bonusByYear).forEach(([year, amt]) => {
        const k = `${year}-${String(bonusMonth).padStart(2, '0')}`
        if (!map[k]) map[k] = { key: k, year: parseInt(year), month: bonusMonth - 1, income: 0, expenses: 0 }
        map[k].income += amt
      })
    }

    const rows       = Object.values(map).sort((a, b) => a.key.localeCompare(b.key))
    const monthCount = rows.length
    // Spread: divide total bonus evenly across all months
    const bonusPer   = monthCount > 0 && bonusMode === 'spread' ? totalBonus / monthCount : 0

    return rows.map(row => ({
      key:      row.key,
      label:    `${MONTH_ABBR[row.month]} ${row.year}`,
      income:   +(row.income + bonusPer).toFixed(2),
      expenses: +row.expenses.toFixed(2),
      net:      +(row.income + bonusPer - row.expenses).toFixed(2),
    }))
  }, [transactions, earnerView, bonusMode, bonusMonth])

  // ── Historical rows with running cash balances ───────────
  const historicalWithBalances = useMemo(() => {
    let runBal = balances.begin
    return historicalData.map(row => {
      const beginBal = runBal
      const endBal   = +(beginBal + row.net).toFixed(2)
      runBal = endBal
      return { ...row, beginBal: +beginBal.toFixed(2), endBal }
    })
  }, [historicalData, balances.begin])

  // ── Projected ────────────────────────────────────────────
  const projectedData = useMemo(() => {
    const budget = readBudget()
    if (!budget) return []

    // Spread mode  → full earnerTakeHome (includes bonus/12)
    // Lump sum mode → earnerTakeHomeBase (no bonus) + full bonus in selected month
    let projIncome     = 0   // monthly (spread)
    let projIncomeBase = 0   // monthly without bonus (lump sum base)
    let projBonus      = 0   // annual bonus for lump sum
    let projSavings    = 0

    if (earnerView === 'combined') {
      projIncome     = earnerTakeHome(budget.earner1     ?? budget.income) + earnerTakeHome(budget.earner2     ?? {})
      projIncomeBase = earnerTakeHomeBase(budget.earner1 ?? budget.income) + earnerTakeHomeBase(budget.earner2 ?? {})
      projBonus      = earnerBonusAnnual(budget.earner1  ?? budget.income) + earnerBonusAnnual(budget.earner2  ?? {})
      projSavings    = earnerSavings(budget.earner1      ?? budget.income) + earnerSavings(budget.earner2      ?? {})
    } else if (earnerView === 'p1') {
      projIncome     = earnerTakeHome(budget.earner1     ?? budget.income)
      projIncomeBase = earnerTakeHomeBase(budget.earner1 ?? budget.income)
      projBonus      = earnerBonusAnnual(budget.earner1  ?? budget.income)
      projSavings    = earnerSavings(budget.earner1      ?? budget.income)
    } else {
      projIncome     = earnerTakeHome(budget.earner2     ?? {})
      projIncomeBase = earnerTakeHomeBase(budget.earner2 ?? {})
      projBonus      = earnerBonusAnnual(budget.earner2  ?? {})
      projSavings    = earnerSavings(budget.earner2      ?? {})
    }

    const fixed         = (budget.fixedExpenses ?? []).reduce((s, r) => s + (r.amount || 0), 0)
    const discretionary = spendingMode?.mode === 'simple'
      ? (spendingMode?.monthly || 0)
      : (budget.discretionary ?? []).reduce((s, r) => s + (r.amount || 0), 0)
    const loans         = readLoans()
    const loanPayments  = loans.reduce((s, l) => s + loanMonthlyPayment(l), 0)

    const espp     = readEsppData()
    const esppPlan = espp?.plan ?? null

    const { rentalIncome, rentalExpenses } = calcRentalMonthly(readRentals())

    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d        = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
      const monthNum = d.getMonth() + 1  // 1–12
      const dateStr  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

      let monthlyIncome
      if (bonusMode === 'lump_sum') {
        // Base pay every month, full annual bonus only in the selected month
        const bonusThisMonth = monthNum === bonusMonth ? projBonus : 0
        monthlyIncome = projIncomeBase + bonusThisMonth
      } else {
        // Spread: earnerTakeHome already includes bonus ÷ 12
        monthlyIncome = projIncome
      }

      const esppContrib = esppMonthlyForDate(esppPlan, dateStr)
      const totalIncome = monthlyIncome + rentalIncome
      const totalFixed  = fixed + rentalExpenses

      return {
        label:          `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`,
        income:         +totalIncome.toFixed(2),
        fixed:          +totalFixed.toFixed(2),
        discretionary:  +discretionary.toFixed(2),
        loanPayments:   +loanPayments.toFixed(2),
        savings:        +projSavings.toFixed(2),
        esppContrib:    +esppContrib.toFixed(2),
        rentalIncome:   +rentalIncome.toFixed(2),
        rentalExpenses: +rentalExpenses.toFixed(2),
        net:            +(totalIncome - totalFixed - discretionary - esppContrib).toFixed(2),
      }
    })
  }, [earnerView, bonusMode, bonusMonth, spendingMode])

  // ── Summary stats ─────────────────────────────────────────
  const histStats = useMemo(() => {
    if (!historicalData.length) return null
    const totalIncome   = historicalData.reduce((s, r) => s + r.income,   0)
    const totalExpenses = historicalData.reduce((s, r) => s + r.expenses, 0)
    const avgNet        = (totalIncome - totalExpenses) / historicalData.length
    const savingsRate   = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0
    return { totalIncome, totalExpenses, avgNet, savingsRate, months: historicalData.length }
  }, [historicalData])

  // Ending balance = last historical month's running balance (or begin if no history)
  const autoEndBalance = historicalWithBalances.length > 0
    ? historicalWithBalances[historicalWithBalances.length - 1].endBal
    : balances.begin
  const endBalance = balances.endOverride ? balances.endAmount : autoEndBalance
  const netChange  = endBalance - balances.begin

  // ── Projected rows with running cash balances ─────────────
  // Starts from wherever the historical period ended
  const projectedWithBalances = useMemo(() => {
    let runBal = endBalance
    return projectedData.map(row => {
      const beginBal = runBal
      const endBal   = +(beginBal + row.net).toFixed(2)
      runBal = endBal
      return { ...row, beginBal: +beginBal.toFixed(2), endBal }
    })
  // endBalance is a primitive derived from state/memos — React will diff it by value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectedData, endBalance])

  const earnerLabel = earnerView === 'combined'
    ? 'Combined Household'
    : earnerView === 'p1' ? household.p1 : household.p2

  const CustomTooltipHistorical = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="cf-tooltip">
        <strong>{label}</strong>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {fmtFull(p.value)}
          </div>
        ))}
      </div>
    )
  }

  const CustomTooltipProjected = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="cf-tooltip">
        <strong>{label}</strong>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {fmtFull(p.value)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="cashflow-page">

      {/* ── Cash Position card ── */}
      <div className="card cf-card">
        <div className="cf-position-header">
          <h2>Cash Position</h2>

          {/* Bonus controls */}
          <div className="cf-bonus-controls">
            <div className="cf-bonus-toggle">
              <span className="cf-bonus-label">Bonus Distribution</span>
              <div className="cf-bonus-options">
                <button
                  className={`cf-bonus-btn ${bonusMode === 'lump_sum' ? 'active' : ''}`}
                  onClick={() => setBonusMode('lump_sum')}
                >
                  Lump Sum
                </button>
                <button
                  className={`cf-bonus-btn ${bonusMode === 'spread' ? 'active' : ''}`}
                  onClick={() => setBonusMode('spread')}
                >
                  Spread Evenly
                </button>
              </div>
            </div>

            <div className="cf-bonus-month-row">
              <span className="cf-bonus-label">
                {bonusMode === 'lump_sum' ? 'Bonus Month' : 'Expected Month'}
              </span>
              <select
                className="cf-bonus-month-select"
                value={bonusMonth}
                onChange={e => setBonusMonth(parseInt(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="cf-balances-row">
          {/* Beginning balance */}
          <div className="cf-balance-block">
            <span className="rc-label">Beginning Balance</span>
            <div className="nw-num-wrap" style={{ marginTop: '6px' }}>
              <span className="nw-prefix">$</span>
              <input
                className="nw-num-input"
                type="number"
                min="0"
                step="100"
                style={{ width: '110px' }}
                value={balances.begin || ''}
                placeholder="0"
                onChange={e => setBalance('begin', parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Arrow + net change */}
          <div className="cf-balance-arrow">
            <span className="cf-balance-net" style={{ color: netChange >= 0 ? '#10b981' : '#ef4444' }}>
              {netChange >= 0 ? '+' : ''}{fmtFull(netChange)}
            </span>
            <span className="cf-balance-arrow-line">→</span>
          </div>

          {/* Ending balance */}
          <div className="cf-balance-block">
            <span className="rc-label">Ending Balance</span>
            {balances.endOverride ? (
              <div className="nw-num-wrap" style={{ marginTop: '6px' }}>
                <span className="nw-prefix">$</span>
                <input
                  className="nw-num-input"
                  type="number"
                  min="0"
                  step="100"
                  style={{ width: '110px' }}
                  value={balances.endAmount || ''}
                  placeholder="0"
                  onChange={e => setBalance('endAmount', parseFloat(e.target.value) || 0)}
                />
              </div>
            ) : (
              <div className="cf-end-auto" style={{ marginTop: '6px' }}>
                <span className="cf-end-val">{fmtFull(autoEndBalance)}</span>
                <span className="cf-end-auto-hint">auto</span>
              </div>
            )}
            <label className="cf-override-label" style={{ marginTop: '6px' }}>
              <input
                type="checkbox"
                checked={balances.endOverride}
                onChange={e => setBalance('endOverride', e.target.checked)}
                style={{ marginRight: '5px' }}
              />
              Manual override
            </label>
          </div>

          {/* Net summary chip */}
          <div className="cf-balance-summary">
            <div className="cf-balance-chip" style={{
              background:  netChange >= 0 ? '#ecfdf5' : '#fef2f2',
              borderColor: netChange >= 0 ? '#a7f3d0' : '#fecaca',
              color:       netChange >= 0 ? '#065f46' : '#991b1b',
            }}>
              <span className="cf-balance-chip-label">Net Change</span>
              <strong className="cf-balance-chip-val">{netChange >= 0 ? '+' : ''}{fmtFull(netChange)}</strong>
            </div>
            {bonusMode === 'spread' && (
              <div className="cf-bonus-badge">
                📊 Bonus spread across {historicalData.length} months
              </div>
            )}
            {bonusMode === 'lump_sum' && (
              <div className="cf-bonus-badge cf-bonus-badge-lump">
                💰 Bonus lands in {MONTH_NAMES[bonusMonth - 1]}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Historical ── */}
      <div className="card cf-card">
        <div className="cf-card-header">
          <div>
            <h2>Historical Cash Flow</h2>
            <p className="bp-subtitle">{earnerLabel} · {historicalData.length} months of data</p>
          </div>
          {histStats && (
            <div className="cf-quick-stats">
              <div className="cf-stat cf-stat-income">
                <span>Avg Income/mo</span>
                <strong>{fmtFull(histStats.totalIncome / histStats.months)}</strong>
              </div>
              <div className="cf-stat cf-stat-expense">
                <span>Avg Expense/mo</span>
                <strong>{fmtFull(histStats.totalExpenses / histStats.months)}</strong>
              </div>
              <div className={`cf-stat ${histStats.avgNet >= 0 ? 'cf-stat-pos' : 'cf-stat-neg'}`}>
                <span>Avg Net/mo</span>
                <strong>{fmtFull(histStats.avgNet)}</strong>
              </div>
              <div className="cf-stat cf-stat-rate">
                <span>Savings Rate</span>
                <strong>{histStats.savingsRate.toFixed(1)}%</strong>
              </div>
            </div>
          )}
        </div>

        {historicalData.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <p>No transaction history yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={historicalData} margin={{ top: 5, right: 12, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={52} />
              <Tooltip content={<CustomTooltipHistorical />} />
              <Legend />
              <Bar dataKey="income"   name="Income"   fill="#10b981" opacity={0.85} radius={[3,3,0,0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" opacity={0.75} radius={[3,3,0,0]} />
              <ReferenceLine y={0} stroke="#94a3b8" />
              <Line type="monotone" dataKey="net" name="Net"
                stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Monthly table with running balances */}
        {historicalWithBalances.length > 0 && (
          <div className="cf-table-wrap">
            <table className="cf-table cf-table-wide">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Income</th>
                  <th>Expenses</th>
                  <th>Net</th>
                  <th>Savings Rate</th>
                  <th className="cf-bal-sep">Beg. Balance</th>
                  <th>End Balance</th>
                </tr>
              </thead>
              <tbody>
                {[...historicalWithBalances].reverse().map(row => {
                  const rate = row.income > 0
                    ? ((row.net / row.income) * 100).toFixed(1)
                    : '—'
                  return (
                    <tr key={row.key ?? row.label}>
                      <td className="cf-month-label">{row.label}</td>
                      <td className="cf-income">{fmtFull(row.income)}</td>
                      <td className="cf-expense">{fmtFull(row.expenses)}</td>
                      <td className={row.net >= 0 ? 'cf-pos' : 'cf-neg'}>{fmtFull(row.net)}</td>
                      <td className={`cf-rate ${parseFloat(rate) >= 20 ? 'cf-rate-good' : ''}`}>
                        {rate !== '—' ? `${rate}%` : '—'}
                      </td>
                      <td className="cf-bal cf-bal-sep">{fmtFull(row.beginBal)}</td>
                      <td className={`cf-bal ${row.endBal >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                        {fmtFull(row.endBal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {histStats && (
                  <tr className="cf-table-total">
                    <td>Total / Final</td>
                    <td className="cf-income">{fmtFull(histStats.totalIncome)}</td>
                    <td className="cf-expense">{fmtFull(histStats.totalExpenses)}</td>
                    <td className={histStats.totalIncome - histStats.totalExpenses >= 0 ? 'cf-pos' : 'cf-neg'}>
                      {fmtFull(histStats.totalIncome - histStats.totalExpenses)}
                    </td>
                    <td className="cf-rate">{histStats.savingsRate.toFixed(1)}%</td>
                    <td className="cf-bal cf-bal-sep">{fmtFull(balances.begin)}</td>
                    <td className={`cf-bal ${autoEndBalance >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                      {fmtFull(autoEndBalance)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Projected ── */}
      <div className="card cf-card">
        <div className="cf-card-header">
          <div>
            <h2>Projected Cash Flow</h2>
            <p className="bp-subtitle">
              {earnerLabel} · Next 12 months · Based on your Budget Planner
            </p>
          </div>
        </div>

        {projectedData.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <p>Set up your Budget Planner to see projections.</p>
          </div>
        ) : (
          <>
            {(() => {
              const showEspp = projectedData.some(r => r.esppContrib > 0)
              return (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={projectedData} margin={{ top: 5, right: 12, left: 8, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip content={<CustomTooltipProjected />} />
                    <Legend />
                    <Bar dataKey="income"        name="Take-Home"     fill="#10b981" opacity={0.85} radius={[3,3,0,0]} />
                    <Bar dataKey="fixed"         name="Fixed Exp."    fill="#6366f1" opacity={0.75} radius={[3,3,0,0]} />
                    <Bar dataKey="discretionary" name="Discretionary" fill="#f59e0b" opacity={0.75} radius={[3,3,0,0]} />
                    {showEspp && (
                      <Bar dataKey="esppContrib" name="ESPP" fill="#8b5cf6" opacity={0.75} radius={[3,3,0,0]} />
                    )}
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Line type="monotone" dataKey="net" name="Net Cash Flow"
                      stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="5 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            })()}

            {/* Loan payments callout */}
            {projectedData[0]?.loanPayments > 0 && (
              <div className="cf-loan-callout">
                <span className="cf-loan-callout-icon">🔗</span>
                <span>
                  <strong>Loans:</strong> {fmtFull(projectedData[0].loanPayments)}/mo in total loan payments
                  (from your Loans page). Verify these are included in your Fixed Expenses above to avoid double-counting.
                </span>
              </div>
            )}

            {/* ESPP callout */}
            {projectedData.some(r => r.esppContrib > 0) && (
              <div className="cf-loan-callout" style={{ borderColor: '#c4b5fd', background: '#f5f3ff' }}>
                <span className="cf-loan-callout-icon">📈</span>
                <span>
                  <strong>ESPP Contributions:</strong> {fmtFull(projectedData.find(r => r.esppContrib > 0)?.esppContrib ?? 0)}/mo
                  deducted from take-home pay during your offering period. Months outside the offering period show $0.
                </span>
              </div>
            )}

            {/* Rental callout */}
            {projectedData[0]?.rentalIncome > 0 && (
              <div className="cf-loan-callout" style={{ borderColor: '#93c5fd', background: '#eff6ff' }}>
                <span className="cf-loan-callout-icon">🏠</span>
                <span>
                  <strong>Rentals:</strong> {fmtFull(projectedData[0].rentalIncome)}/mo rental income
                  and {fmtFull(projectedData[0].rentalExpenses)}/mo expenses included
                  (net {fmtFull(projectedData[0].rentalIncome - projectedData[0].rentalExpenses)}/mo).
                  Edit in Rentals tab.
                </span>
              </div>
            )}

            {/* Projected table with running balances */}
            {(() => {
              const showEspp = projectedData.some(r => r.esppContrib > 0)
              return (
                <div className="cf-table-wrap">
                  <table className="cf-table cf-table-wide">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Take-Home</th>
                        <th>Fixed</th>
                        <th>Discretionary</th>
                        {showEspp && <th>ESPP</th>}
                        <th>Net</th>
                        <th className="cf-bal-sep">Beg. Balance</th>
                        <th>End Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectedWithBalances.map(row => (
                        <tr key={row.label}>
                          <td className="cf-month-label">{row.label}</td>
                          <td className="cf-income">{fmtFull(row.income)}</td>
                          <td className="cf-expense">{fmtFull(row.fixed)}</td>
                          <td className="cf-expense">{fmtFull(row.discretionary)}</td>
                          {showEspp && (
                            <td className={row.esppContrib > 0 ? 'cf-expense' : 'cf-muted'}>
                              {row.esppContrib > 0 ? fmtFull(row.esppContrib) : '—'}
                            </td>
                          )}
                          <td className={row.net >= 0 ? 'cf-pos' : 'cf-neg'}>{fmtFull(row.net)}</td>
                          <td className="cf-bal cf-bal-sep">{fmtFull(row.beginBal)}</td>
                          <td className={`cf-bal ${row.endBal >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                            {fmtFull(row.endBal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {projectedWithBalances.length > 0 && (
                      <tfoot>
                        <tr className="cf-table-total">
                          <td>Final Balance</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          {showEspp && <td></td>}
                          <td></td>
                          <td className="cf-bal cf-bal-sep">{fmtFull(endBalance)}</td>
                          <td className={`cf-bal ${projectedWithBalances[projectedWithBalances.length - 1].endBal >= 0 ? 'cf-bal-pos' : 'cf-bal-neg'}`}>
                            {fmtFull(projectedWithBalances[projectedWithBalances.length - 1].endBal)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )
            })()}
          </>
        )}
      </div>

    </div>
  )
}
