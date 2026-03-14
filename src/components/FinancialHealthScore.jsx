import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

const HEALTH_KEY = 'sage_health'

// ── Read all module data ───────────────────────────────────────
function readAll() {
  function tryParse(key) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null } catch { return null }
  }

  const budget = tryParse('finance_budget')
  const emergency = tryParse('sage_emergency')
  const debtData = tryParse('sage_debtpayoff')
  const retirement = tryParse('sage_retirement')
  const investments = tryParse('sage_investments')
  const networth = tryParse('finance_networth')

  // ── Budget metrics ──
  let budgetMetrics = null
  if (budget) {
    const e1 = budget.earner1 || budget.income || {}
    const e2 = budget.earner2 || {}
    const grossIncome = (e1.grossIncome || 0) + (e2.grossIncome || 0)
    const taxes = (e1.taxes || 0) + (e2.taxes || 0)
    const retSavings = (e1.retirementSavings || 0) + (e2.retirementSavings || 0)
    const otherSavings = (e1.otherSavings || 0) + (e2.otherSavings || 0)
    const takeHome = grossIncome - taxes - retSavings - otherSavings
    const totalFixed = (budget.fixedExpenses || []).reduce((s, r) => s + (r.amount || 0), 0)
    const totalDisc = (budget.discretionary || []).reduce((s, r) => s + (r.amount || 0), 0)
    const totalExpenses = totalFixed + totalDisc
    const remaining = takeHome - totalExpenses
    const totalSaved = retSavings + otherSavings + Math.max(0, remaining)
    const savingsRate = grossIncome > 0 ? totalSaved / grossIncome : 0
    const cashflowRatio = takeHome > 0 ? remaining / takeHome : 0
    budgetMetrics = { grossIncome, takeHome, totalExpenses, remaining, savingsRate, cashflowRatio, retSavings, otherSavings }
  }

  // ── Emergency fund metrics ──
  let efMetrics = null
  if (emergency) {
    const months = emergency.monthlyExpenses > 0
      ? emergency.currentBalance / emergency.monthlyExpenses : 0
    efMetrics = { months, target: emergency.targetMonths || 6, balance: emergency.currentBalance }
  }

  // ── Debt metrics ──
  let debtMetrics = null
  if (debtData?.debts?.length) {
    const debts = debtData.debts.filter(d => d.balance > 0)
    const totalBalance = debts.reduce((s, d) => s + (d.balance || 0), 0)
    const totalMinPayment = debts.reduce((s, d) => s + (d.minPayment || 0), 0)
    const grossIncome = budgetMetrics?.grossIncome || 1
    const dti = totalMinPayment / grossIncome
    const avgRate = totalBalance > 0
      ? debts.reduce((s, d) => s + (d.rate || 0) * (d.balance || 0), 0) / totalBalance : 0
    const hasHighInterest = debts.some(d => d.rate > 15 && d.balance > 500)
    const creditCardDebt = debts.filter(d => d.type === 'credit_card').reduce((s, d) => s + d.balance, 0)
    debtMetrics = { totalBalance, totalMinPayment, dti, avgRate, hasHighInterest, creditCardDebt, count: debts.length }
  }

  // ── Retirement metrics (recompute from stored inputs) ──
  let retMetrics = null
  if (retirement) {
    const r = retirement
    const yearsToRetire = Math.max(0, (r.retireAge || 65) - Math.max(r.p1Age || 35, r.p2Age || 33))
    const monthlyRate   = ((r.preReturnRate || 7) / 100) / 12
    const n             = yearsToRetire * 12
    const savings       = r.currentSavings || 0
    const contrib       = r.monthlyContrib || 0
    const fv = n > 0
      ? savings * Math.pow(1 + monthlyRate, n) + contrib * (Math.pow(1 + monthlyRate, n) - 1) / monthlyRate
      : savings
    const annualSpending  = r.annualSpending || 72_000
    const annualIncome    = ((r.p1SS || 0) + (r.p2SS || 0) + (r.pensionMonthly || 0) + (r.otherMonthly || 0)) * 12
    const withdrawalNeeded = Math.max(0, annualSpending - annualIncome)
    const fireNumber      = withdrawalNeeded > 0 ? withdrawalNeeded / ((r.safeWithdrawalRate || 4) / 100) : 0
    const pct = fireNumber > 0 ? fv / fireNumber : 1
    retMetrics = { pct: Math.min(pct, 1.5), fireNumber, projected: fv }
  }

  // ── Investment metrics ──
  let invMetrics = null
  if (investments?.holdings?.length) {
    const total = investments.holdings.reduce((s, h) => s + (h.value || 0), 0)
    const targetSum = Object.values(investments.target || {}).reduce((s, v) => s + v, 0)
    const hasTarget = Math.abs(targetSum - 100) <= 5
    const assetClasses = new Set(investments.holdings.map(h => h.assetClass)).size
    invMetrics = { total, hasTarget, assetClasses }
  }

  // ── Net worth (stored as a plain array) ──
  let nwMetrics = null
  const nwArr = Array.isArray(networth) ? networth : networth?.accounts
  if (nwArr?.length) {
    const total = nwArr.reduce((s, a) => s + (a.balance || 0), 0)
    nwMetrics = { total }
  }

  return { budgetMetrics, efMetrics, debtMetrics, retMetrics, invMetrics, nwMetrics }
}

// ── Scoring functions ──────────────────────────────────────────
function clamp(v, min = 0, max = 100) { return Math.min(max, Math.max(min, v)) }

function scoreEmergencyFund(ef) {
  if (!ef) return { score: 0, status: 'No data', detail: 'Set up Emergency Fund tab to score this area.' }
  const m = ef.months
  const score = clamp(
    m >= 6 ? 100 :
    m >= 3 ? Math.round(70 + ((m - 3) / 3) * 30) :
    m >= 1 ? Math.round(40 + ((m - 1) / 2) * 30) :
             Math.round(m * 40)
  )
  return {
    score,
    status: m >= 6 ? 'Fully Funded' : m >= 3 ? 'Adequate' : m >= 1 ? 'Building' : 'Critical',
    detail: `${m.toFixed(1)} months of expenses covered (target: ${ef.target})`,
    metric: `${m.toFixed(1)} mo`,
  }
}

function scoreDebt(debt, grossIncome) {
  if (!debt) return { score: 95, status: 'No debts entered', detail: 'Add debts in the Debt Payoff tab if applicable.', metric: 'N/A' }
  if (debt.count === 0 || debt.totalBalance === 0) return { score: 100, status: 'Debt Free', detail: 'No outstanding debt — excellent!', metric: '$0' }
  const dtiPct = debt.dti * 100
  let score = dtiPct >= 43 ? 10
            : dtiPct >= 36 ? 30
            : dtiPct >= 28 ? 55
            : dtiPct >= 15 ? 75
            : 88
  if (debt.hasHighInterest) score = clamp(score - 15)
  if (debt.creditCardDebt > 0) score = clamp(score - 10)
  return {
    score: clamp(score),
    status: score >= 80 ? 'Manageable' : score >= 55 ? 'Moderate' : score >= 30 ? 'High' : 'Critical',
    detail: `DTI ${dtiPct.toFixed(1)}%${debt.hasHighInterest ? ' · High-interest debt present' : ''}`,
    metric: `${dtiPct.toFixed(0)}% DTI`,
  }
}

function scoreSavingsRate(budget) {
  if (!budget) return { score: 0, status: 'No data', detail: 'Set up Budget Planner to score this area.', metric: 'N/A' }
  const r = budget.savingsRate * 100
  const score = clamp(
    r >= 20 ? 100 :
    r >= 15 ? Math.round(85 + ((r - 15) / 5) * 15) :
    r >= 10 ? Math.round(70 + ((r - 10) / 5) * 15) :
    r >= 5  ? Math.round(45 + ((r - 5) / 5) * 25) :
    r > 0   ? Math.round(r / 5 * 45) : 0
  )
  return {
    score,
    status: r >= 20 ? 'Excellent' : r >= 15 ? 'Great' : r >= 10 ? 'Good' : r >= 5 ? 'Low' : 'Critical',
    detail: `Saving ${r.toFixed(1)}% of gross income (target: 15–20%)`,
    metric: `${r.toFixed(1)}%`,
  }
}

function scoreCashflow(budget) {
  if (!budget) return { score: 0, status: 'No data', detail: 'Set up Budget Planner to score this area.', metric: 'N/A' }
  const r = budget.cashflowRatio * 100
  const score = clamp(
    r >= 20 ? 100 :
    r >= 10 ? Math.round(75 + ((r - 10) / 10) * 25) :
    r >= 5  ? Math.round(55 + ((r - 5) / 5) * 20) :
    r >= 0  ? Math.round(r / 5 * 55) : 0
  )
  return {
    score: clamp(score),
    status: r >= 20 ? 'Healthy' : r >= 10 ? 'Comfortable' : r >= 5 ? 'Tight' : r >= 0 ? 'Bare' : 'Deficit',
    detail: `${r >= 0 ? '+' : ''}${r.toFixed(1)}% of take-home unallocated after expenses`,
    metric: `${r >= 0 ? '+' : ''}${r.toFixed(0)}%`,
  }
}

function scoreRetirement(ret) {
  if (!ret) return { score: 0, status: 'No data', detail: 'Set up Retirement Calculator to score this area.', metric: 'N/A' }
  const p = ret.pct * 100
  const score = clamp(
    p >= 110 ? 100 :
    p >= 90  ? Math.round(88 + ((p - 90) / 20) * 12) :
    p >= 70  ? Math.round(70 + ((p - 70) / 20) * 18) :
    p >= 50  ? Math.round(50 + ((p - 50) / 20) * 20) :
    p >= 25  ? Math.round(25 + ((p - 25) / 25) * 25) :
               Math.round(p)
  )
  return {
    score: clamp(score),
    status: score >= 88 ? 'On Track' : score >= 70 ? 'Adequate' : score >= 50 ? 'Behind' : 'Off Track',
    detail: `${p.toFixed(0)}% of retirement goal funded or projected`,
    metric: `${p.toFixed(0)}%`,
  }
}

function scoreInvestments(inv) {
  if (!inv) return { score: 0, status: 'No data', detail: 'Add holdings in the Investments tab to score this area.', metric: 'N/A' }
  if (inv.total === 0) return { score: 10, status: 'Not Started', detail: 'No investment holdings entered.', metric: '$0' }
  let score = 30 // base for having investments
  if (inv.hasTarget)    score += 35
  if (inv.assetClasses >= 4) score += 25
  else if (inv.assetClasses >= 2) score += 15
  if (inv.assetClasses >= 6) score += 10
  return {
    score: clamp(score),
    status: score >= 80 ? 'Diversified' : score >= 55 ? 'Developing' : score >= 30 ? 'Getting Started' : 'Not Started',
    detail: `${inv.assetClasses} asset classes · ${inv.hasTarget ? 'Target set' : 'No target allocation'}`,
    metric: `${inv.assetClasses} classes`,
  }
}

const CATEGORIES = [
  { key: 'ef',       label: 'Emergency Fund',    icon: '🛡️', weight: 0.20, scorer: (d) => scoreEmergencyFund(d.efMetrics) },
  { key: 'debt',     label: 'Debt Management',   icon: '💳', weight: 0.20, scorer: (d) => scoreDebt(d.debtMetrics, d.budgetMetrics?.grossIncome) },
  { key: 'savings',  label: 'Savings Rate',       icon: '💰', weight: 0.15, scorer: (d) => scoreSavingsRate(d.budgetMetrics) },
  { key: 'cashflow', label: 'Cash Flow',          icon: '📊', weight: 0.15, scorer: (d) => scoreCashflow(d.budgetMetrics) },
  { key: 'retire',   label: 'Retirement',         icon: '🏖️', weight: 0.20, scorer: (d) => scoreRetirement(d.retMetrics) },
  { key: 'invest',   label: 'Investments',        icon: '📈', weight: 0.10, scorer: (d) => scoreInvestments(d.invMetrics) },
]

function getGrade(score) {
  if (score >= 90) return { grade: 'A', label: 'Excellent',   color: '#059669', bg: '#ecfdf5' }
  if (score >= 80) return { grade: 'B', label: 'Good',        color: '#0284c7', bg: '#eff6ff' }
  if (score >= 65) return { grade: 'C', label: 'Fair',        color: '#7c3aed', bg: '#f5f3ff' }
  if (score >= 45) return { grade: 'D', label: 'Needs Work',  color: '#d97706', bg: '#fffbeb' }
  return               { grade: 'F', label: 'Critical',     color: '#dc2626', bg: '#fef2f2' }
}

function getScoreColor(s) {
  if (s >= 80) return '#059669'
  if (s >= 65) return '#0284c7'
  if (s >= 45) return '#7c3aed'
  if (s >= 30) return '#d97706'
  return '#dc2626'
}

function loadHistory() {
  try {
    const s = localStorage.getItem(HEALTH_KEY)
    return s ? JSON.parse(s) : { history: [] }
  } catch { return { history: [] } }
}

export default function FinancialHealthScore() {
  const [stored, setStored] = useState(loadHistory)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(stored))
    setAppData('financial_health', stored).catch(console.error)
  }, [stored])

  const data = useMemo(() => readAll(), [])

  const scores = useMemo(() => {
    const cat = CATEGORIES.map(c => ({ ...c, ...c.scorer(data) }))
    const overall = Math.round(cat.reduce((s, c) => s + c.score * c.weight, 0))
    return { cat, overall }
  }, [data])

  const grade = getGrade(scores.overall)
  const scoreColor = getScoreColor(scores.overall)

  // Gauge data (semicircle)
  const gaugeData = [
    { value: scores.overall },
    { value: 100 - scores.overall },
  ]

  // Recommendations
  const recommendations = useMemo(() => {
    const recs = []
    const cat = scores.cat

    const ef = cat.find(c => c.key === 'ef')
    if (ef.score < 70) recs.push({
      priority: ef.score < 40 ? 'high' : 'medium',
      category: 'Emergency Fund',
      icon: '🛡️',
      text: ef.score < 40
        ? 'Build a starter emergency fund of at least 1 month of expenses immediately.'
        : 'Increase your emergency fund to 3–6 months of expenses.',
      action: 'Emergency tab → increase monthly contribution',
    })

    const debt = cat.find(c => c.key === 'debt')
    if (debt.score < 70 && data.debtMetrics?.totalBalance > 0) recs.push({
      priority: debt.score < 40 ? 'high' : 'medium',
      category: 'Debt',
      icon: '💳',
      text: data.debtMetrics?.hasHighInterest
        ? 'Pay off high-interest credit card debt first — it costs you the most per dollar.'
        : 'Your debt-to-income ratio is elevated. Add extra payments to accelerate payoff.',
      action: 'Debt Payoff tab → increase extra payment',
    })

    const savings = cat.find(c => c.key === 'savings')
    if (savings.score < 65) recs.push({
      priority: savings.score < 40 ? 'high' : 'medium',
      category: 'Savings Rate',
      icon: '💰',
      text: 'Aim to save at least 15% of gross income. Automate contributions so it happens before you spend.',
      action: 'Budget tab → increase retirement or other savings',
    })

    const cf = cat.find(c => c.key === 'cashflow')
    if (cf.score < 55) recs.push({
      priority: 'medium',
      category: 'Cash Flow',
      icon: '📊',
      text: cf.score < 20
        ? 'You are spending more than you take home. Cut discretionary spending immediately.'
        : 'Tight cash flow leaves no buffer. Review discretionary spending for cuts.',
      action: 'Budget tab → reduce discretionary expenses',
    })

    const ret = cat.find(c => c.key === 'retire')
    if (ret.score < 65) recs.push({
      priority: 'medium',
      category: 'Retirement',
      icon: '🏖️',
      text: 'Boost retirement contributions. Max out employer match first, then IRA/Roth IRA.',
      action: 'Retirement tab → review contribution amount',
    })

    const inv = cat.find(c => c.key === 'invest')
    if (inv.score < 55) recs.push({
      priority: 'low',
      category: 'Investments',
      icon: '📈',
      text: 'Diversify across multiple asset classes and set a target allocation for rebalancing.',
      action: 'Investments tab → set target allocation',
    })

    return recs.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 }
      return p[a.priority] - p[b.priority]
    }).slice(0, 5)
  }, [scores, data])

  function logScore() {
    const now = new Date()
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const entry = { date: key, overall: scores.overall, ...Object.fromEntries(scores.cat.map(c => [c.key, c.score])) }
    setStored(prev => {
      const filtered = (prev.history || []).filter(h => h.date !== key)
      return { history: [...filtered, entry].sort((a, b) => a.date.localeCompare(b.date)) }
    })
  }

  const historyChart = stored.history.map(h => ({
    date: h.date,
    overall: h.overall,
    ef: h.ef,
    debt: h.debt,
    savings: h.savings,
    cashflow: h.cashflow,
    retire: h.retire,
    invest: h.invest,
  }))

  const displayHistory = showAll ? [...stored.history].reverse() : [...stored.history].reverse().slice(0, 6)

  return (
    <div className="fh-page">

      {/* ── Hero Score ── */}
      <div className="card fh-hero-card">
        <div className="fh-hero-inner">

          {/* Gauge */}
          <div className="fh-gauge-wrap">
            <ResponsiveContainer width={220} height={130}>
              <PieChart>
                <Pie data={gaugeData} cx={110} cy={110}
                  startAngle={180} endAngle={0}
                  innerRadius={72} outerRadius={100}
                  dataKey="value" strokeWidth={0}>
                  <Cell fill={scoreColor} />
                  <Cell fill="var(--border)" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="fh-gauge-center">
              <span className="fh-score-num" style={{ color: scoreColor }}>{scores.overall}</span>
              <span className="fh-score-label">/ 100</span>
            </div>
          </div>

          {/* Grade + summary */}
          <div className="fh-hero-body">
            <div className="fh-grade-badge" style={{ background: grade.bg, color: grade.color }}>
              <span className="fh-grade-letter">{grade.grade}</span>
              <span className="fh-grade-label">{grade.label}</span>
            </div>
            <p className="fh-hero-desc">
              {scores.overall >= 90 ? "Your finances are in outstanding shape. Keep it up!"
               : scores.overall >= 80 ? "Strong financial health. A few tweaks can push you to excellent."
               : scores.overall >= 65 ? "Good progress — focus on the recommendations below to level up."
               : scores.overall >= 45 ? "Some areas need attention. Prioritize the top action items."
               : "Multiple areas need immediate action. Start with the highest-priority items."}
            </p>
            <div className="fh-hero-weights">
              {CATEGORIES.map(c => (
                <div key={c.key} className="fh-weight-pill">
                  {c.icon} {c.label} <span>{(c.weight * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Log button */}
          <div className="fh-hero-actions">
            <button className="ef-log-btn" onClick={logScore}>Log Score</button>
            <p className="bp-subtitle" style={{ marginTop: 4, textAlign: 'center' }}>Save today's snapshot</p>
          </div>
        </div>
      </div>

      {/* ── Category Score Cards ── */}
      <div className="fh-cat-grid">
        {scores.cat.map(c => {
          const color  = getScoreColor(c.score)
          const radius = 26
          const circ   = 2 * Math.PI * radius
          const dash   = (c.score / 100) * circ
          return (
            <div key={c.key} className="card fh-cat-card">
              <div className="fh-cat-top">
                <span className="fh-cat-icon">{c.icon}</span>
                <div className="fh-cat-info">
                  <div className="fh-cat-label">{c.label}</div>
                  <div className="fh-cat-status" style={{ color }}>{c.status}</div>
                </div>
                {/* Ring */}
                <svg width="56" height="56" viewBox="0 0 60 60" className="fh-ring">
                  <circle cx="30" cy="30" r={radius} fill="none" stroke="var(--border)" strokeWidth="5" />
                  <circle cx="30" cy="30" r={radius} fill="none" stroke={color} strokeWidth="5"
                    strokeDasharray={`${dash} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 30 30)" />
                  <text x="30" y="34" textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>{c.score}</text>
                </svg>
              </div>
              <div className="fh-cat-detail">{c.detail}</div>
              <div className="fh-cat-bar-wrap">
                <div className="fh-cat-bar" style={{ width: `${c.score}%`, background: color }} />
              </div>
              <div className="fh-cat-weight">Weight: {(c.weight * 100).toFixed(0)}%</div>
            </div>
          )
        })}
      </div>

      {/* ── Recommendations ── */}
      {recommendations.length > 0 && (
        <div className="card rc-card">
          <h2>Top Action Items</h2>
          <p className="bp-subtitle">Prioritized recommendations to improve your financial health score.</p>
          <div className="fh-recs">
            {recommendations.map((r, i) => (
              <div key={i} className={`fh-rec fh-rec-${r.priority}`}>
                <div className="fh-rec-left">
                  <span className={`fh-rec-badge fh-rec-badge-${r.priority}`}>
                    {r.priority === 'high' ? 'High' : r.priority === 'medium' ? 'Med' : 'Low'}
                  </span>
                  <span className="fh-rec-icon">{r.icon}</span>
                </div>
                <div className="fh-rec-body">
                  <div className="fh-rec-cat">{r.category}</div>
                  <div className="fh-rec-text">{r.text}</div>
                  <div className="fh-rec-action">→ {r.action}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Score Breakdown Bar ── */}
      <div className="card rc-card">
        <h2>Score Composition</h2>
        <p className="bp-subtitle">How each category contributes to your overall score.</p>
        <div className="fh-breakdown-rows">
          {scores.cat.map(c => {
            const color = getScoreColor(c.score)
            const contribution = Math.round(c.score * c.weight)
            return (
              <div key={c.key} className="fh-bd-row">
                <div className="fh-bd-label">
                  {c.icon} {c.label}
                  <span className="fh-bd-weight">×{(c.weight * 100).toFixed(0)}%</span>
                </div>
                <div className="fh-bd-bar-wrap">
                  <div className="fh-bd-bar" style={{ width: `${c.score}%`, background: color }} />
                </div>
                <div className="fh-bd-scores">
                  <span style={{ color, fontWeight: 700 }}>{c.score}</span>
                  <span className="fh-bd-contrib">+{contribution}</span>
                </div>
              </div>
            )
          })}
          <div className="fh-bd-total">
            <span>Overall Score</span>
            <span style={{ color: scoreColor, fontWeight: 800, fontSize: '1.2rem' }}>{scores.overall}</span>
          </div>
        </div>
      </div>

      {/* ── Score History ── */}
      <div className="card rc-card">
        <div className="rc-card-head" style={{ marginBottom: 12 }}>
          <h2>Score History</h2>
          <button className="ef-log-btn" onClick={logScore}>Log Today</button>
        </div>

        {stored.history.length === 0 ? (
          <p className="bp-subtitle">No history yet. Click "Log Today" to start tracking your score over time.</p>
        ) : (
          <>
            {stored.history.length >= 2 && (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={historyChart} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={28} />
                  <Tooltip formatter={(v, name) => [v, name === 'overall' ? 'Overall' : name]} />
                  <ReferenceLine y={80} stroke="#059669" strokeDasharray="4 3" strokeOpacity={0.5}
                    label={{ value: 'Good', position: 'right', fontSize: 10, fill: '#059669' }} />
                  <Line type="monotone" dataKey="overall" name="Overall" stroke={scoreColor}
                    strokeWidth={3} dot={{ r: 4 }} />
                  {CATEGORIES.map(c => (
                    <Line key={c.key} type="monotone" dataKey={c.key} name={c.label}
                      stroke={getScoreColor(scores.cat.find(s => s.key === c.key)?.score ?? 50)}
                      strokeWidth={1.5} dot={false} strokeOpacity={0.6} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}

            <div className="fh-history-table-wrap">
              <table className="cf-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Month</th>
                    <th>Overall</th>
                    {CATEGORIES.map(c => <th key={c.key}>{c.icon}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {displayHistory.map(h => {
                    const g = getGrade(h.overall)
                    return (
                      <tr key={h.date}>
                        <td style={{ textAlign: 'left', fontWeight: 500 }}>{h.date}</td>
                        <td>
                          <span className="fh-hist-score" style={{ color: getScoreColor(h.overall) }}>
                            {h.overall}
                          </span>
                          <span className="fh-hist-grade" style={{ color: g.color }}> {g.grade}</span>
                        </td>
                        {CATEGORIES.map(c => (
                          <td key={c.key} style={{ color: getScoreColor(h[c.key] ?? 0), fontWeight: 600 }}>
                            {h[c.key] ?? '—'}
                          </td>
                        ))}
                        <td>
                          <button className="bp-delete" onClick={() =>
                            setStored(prev => ({ ...prev, history: prev.history.filter(x => x.date !== h.date) }))
                          }>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {stored.history.length > 6 && (
              <button className="link-btn" style={{ marginTop: 8, fontSize: '0.82rem' }}
                onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show less' : `Show all ${stored.history.length} entries`}
              </button>
            )}
          </>
        )}
      </div>

    </div>
  )
}
