import { useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'

const BUDGET_KEY = 'finance_budget'
const LOANS_KEY  = 'finance_loans'
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Average working days per month (260 trading days / 12)
const AVG_WORK_DAYS = 260 / 12

function fmtFull(n) {
  const abs = Math.abs(n)
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

function loanMonthlyPayment(loan) {
  const { balance, annualRate, termMonths } = loan
  if (!termMonths || balance <= 0) return 0
  if (annualRate === 0) return balance / termMonths
  const r = annualRate / 100 / 12
  return balance * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
}

// Handles both old format (grossIncome/taxes/...) and new format (baseSalary/federalTaxRate/...)
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
    const fed  = taxable * (earnerData.federalTaxRate || 0) / 100
    const state = taxable * (earnerData.stateTaxRate  || 0) / 100
    const fica  = gross * 0.0765
    return gross - fed - state - fica - preTax - (earnerData.otherPostTax || 0)
  }
  // Legacy format
  const { grossIncome = 0, taxes = 0, retirementSavings = 0, otherSavings = 0 } = earnerData
  return grossIncome - taxes - retirementSavings - otherSavings
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

export default function CashFlow({ transactions, earnerView, household }) {
  // ── Historical ──────────────────────────────────────────
  const historicalData = useMemo(() => {
    // Filter by earner
    const txs = earnerView === 'combined'
      ? transactions
      : transactions.filter(tx => !tx.earner || tx.earner === 'joint' || tx.earner === earnerView)

    // Group by YYYY-MM
    const map = {}
    txs.forEach(tx => {
      const d = new Date(tx.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map[key]) map[key] = { key, year: d.getFullYear(), month: d.getMonth(), income: 0, expenses: 0 }
      if (tx.type === 'income')  map[key].income   += tx.amount
      if (tx.type === 'expense') map[key].expenses += tx.amount
    })

    return Object.values(map)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(row => ({
        label:    `${MONTH_ABBR[row.month]} ${row.year}`,
        income:   +row.income.toFixed(2),
        expenses: +row.expenses.toFixed(2),
        net:      +(row.income - row.expenses).toFixed(2),
      }))
  }, [transactions, earnerView])

  // ── Projected ────────────────────────────────────────────
  const projectedData = useMemo(() => {
    const budget = readBudget()
    if (!budget) return []

    let projIncome = 0
    let projSavings = 0
    if (earnerView === 'combined') {
      projIncome  = earnerTakeHome(budget.earner1 ?? budget.income) + earnerTakeHome(budget.earner2 ?? {})
      projSavings = earnerSavings(budget.earner1 ?? budget.income)  + earnerSavings(budget.earner2 ?? {})
    } else if (earnerView === 'p1') {
      projIncome  = earnerTakeHome(budget.earner1 ?? budget.income)
      projSavings = earnerSavings(budget.earner1 ?? budget.income)
    } else {
      projIncome  = earnerTakeHome(budget.earner2 ?? {})
      projSavings = earnerSavings(budget.earner2 ?? {})
    }

    const fixed         = (budget.fixedExpenses ?? []).reduce((s, r) => s + (r.amount || 0), 0)
    const discretionary = (budget.discretionary  ?? []).reduce((s, r) => s + (r.amount || 0), 0)

    // Loan payments from Loans page
    const loans        = readLoans()
    const loanPayments = loans.reduce((s, l) => s + loanMonthlyPayment(l), 0)

    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
      return {
        label:         `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`,
        income:        +projIncome.toFixed(2),
        fixed:         +fixed.toFixed(2),
        discretionary: +discretionary.toFixed(2),
        loanPayments:  +loanPayments.toFixed(2),
        savings:       +projSavings.toFixed(2),
        net:           +(projIncome - fixed - discretionary).toFixed(2),
      }
    })
  }, [earnerView])

  // ── Summary stats ─────────────────────────────────────────
  const histStats = useMemo(() => {
    if (!historicalData.length) return null
    const totalIncome   = historicalData.reduce((s, r) => s + r.income,   0)
    const totalExpenses = historicalData.reduce((s, r) => s + r.expenses, 0)
    const avgNet        = (totalIncome - totalExpenses) / historicalData.length
    const savingsRate   = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0
    return { totalIncome, totalExpenses, avgNet, savingsRate, months: historicalData.length }
  }, [historicalData])

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

        {/* Monthly table */}
        {historicalData.length > 0 && (
          <div className="cf-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Income</th>
                  <th>Expenses</th>
                  <th>Net</th>
                  <th>Savings Rate</th>
                </tr>
              </thead>
              <tbody>
                {[...historicalData].reverse().map(row => {
                  const rate = row.income > 0
                    ? ((row.net / row.income) * 100).toFixed(1)
                    : '—'
                  return (
                    <tr key={row.label}>
                      <td className="cf-month-label">{row.label}</td>
                      <td className="cf-income">{fmtFull(row.income)}</td>
                      <td className="cf-expense">{fmtFull(row.expenses)}</td>
                      <td className={row.net >= 0 ? 'cf-pos' : 'cf-neg'}>{fmtFull(row.net)}</td>
                      <td className={`cf-rate ${parseFloat(rate) >= 20 ? 'cf-rate-good' : ''}`}>
                        {rate !== '—' ? `${rate}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {histStats && (
                  <tr className="cf-table-total">
                    <td>Total</td>
                    <td className="cf-income">{fmtFull(histStats.totalIncome)}</td>
                    <td className="cf-expense">{fmtFull(histStats.totalExpenses)}</td>
                    <td className={histStats.totalIncome - histStats.totalExpenses >= 0 ? 'cf-pos' : 'cf-neg'}>
                      {fmtFull(histStats.totalIncome - histStats.totalExpenses)}
                    </td>
                    <td className="cf-rate">{histStats.savingsRate.toFixed(1)}%</td>
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
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Line type="monotone" dataKey="net" name="Net Cash Flow"
                  stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="5 3" />
              </ComposedChart>
            </ResponsiveContainer>

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

            {/* Projected table */}
            <div className="cf-table-wrap">
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Take-Home</th>
                    <th>Fixed</th>
                    <th>Discretionary</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {projectedData.map(row => (
                    <tr key={row.label}>
                      <td className="cf-month-label">{row.label}</td>
                      <td className="cf-income">{fmtFull(row.income)}</td>
                      <td className="cf-expense">{fmtFull(row.fixed)}</td>
                      <td className="cf-expense">{fmtFull(row.discretionary)}</td>
                      <td className={row.net >= 0 ? 'cf-pos' : 'cf-neg'}>{fmtFull(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

    </div>
  )
}
