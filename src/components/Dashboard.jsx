import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n)     { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmtFull(n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) }

function toMonthly(amount, frequency) {
  switch (frequency) {
    case 'Weekly':    return amount * 52 / 12
    case 'Bi-weekly': return amount * 26 / 12
    case 'Monthly':   return amount
    case 'Quarterly': return amount / 3
    case 'Annual':    return amount / 12
    default:          return amount
  }
}

function nextDueDate(dueDay) {
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), dueDay)
  return thisMonth >= today
    ? thisMonth
    : new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
}

function daysUntil(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date - today) / 86400000)
}

function loadLS(key, fallback) {
  try {
    const s = localStorage.getItem(key)
    if (s) return JSON.parse(s)
    return fallback
  } catch { return fallback }
}

// ── Sub-components ────────────────────────────────────────────

function SummaryCard({ label, value, sub, color, bold }) {
  return (
    <div className="db-summary-card" style={{ '--card-accent': color }}>
      <span className="db-summary-label">{label}</span>
      <span className="db-summary-value" style={{ color: bold || 'var(--text)' }}>{value}</span>
      {sub && <span className="db-summary-sub">{sub}</span>}
    </div>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: {fmt(p.value)}
        </div>
      ))}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────

export default function Dashboard({ transactions, filtered, year, month }) {
  // ── Row 1: Summary ──────────────────────────────────────────
  const income   = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const net      = income - expenses

  const netWorth = useMemo(() => {
    const accounts = loadLS('finance_networth', [])
    const loans    = loadLS('finance_loans', [])
    const assets   = accounts.reduce((s, a) => s + (a.balance || 0), 0)
    const liabs    = loans.reduce((s, l) => s + (l.balance || 0), 0)
    return assets - liabs
  }, [])

  // ── Row 2: 6-month trend ────────────────────────────────────
  const trendData = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
    }
    return months.map(({ year: y, month: m }) => {
      const txs  = transactions.filter(tx => {
        const d = new Date(tx.date)
        return d.getFullYear() === y && d.getMonth() + 1 === m
      })
      const inc  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const exp  = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      return { name: MONTH_SHORT[m - 1], Income: Math.round(inc), Expenses: Math.round(exp) }
    })
  }, [transactions])

  // ── Row 3: Widget data ──────────────────────────────────────
  const emergency = useMemo(() => {
    const ef = loadLS('sage_emergency', {
      currentBalance: 0, targetMonths: 6, monthlyExpenses: 3500, monthlyContribution: 500,
    })
    const target  = ef.targetMonths * ef.monthlyExpenses
    const pct     = target > 0 ? Math.min(1, ef.currentBalance / target) : 0
    const covered = ef.monthlyExpenses > 0 ? ef.currentBalance / ef.monthlyExpenses : 0
    return { balance: ef.currentBalance, target, pct, covered, months: ef.targetMonths }
  }, [])

  const bills = useMemo(() => {
    const DEFAULT_BILLS = [
      { id: 'b01', name: 'Rent',          amount: 1350,  frequency: 'Monthly',  category: 'Housing',        dueDay: 1,  active: true },
      { id: 'b02', name: 'Electric',       amount: 94,    frequency: 'Monthly',  category: 'Utilities',      dueDay: 3,  active: true },
      { id: 'b03', name: 'Internet',       amount: 32,    frequency: 'Monthly',  category: 'Utilities',      dueDay: 6,  active: true },
      { id: 'b04', name: 'Netflix',        amount: 15.99, frequency: 'Monthly',  category: 'Entertainment',  dueDay: 1,  active: true },
      { id: 'b05', name: 'Spotify',        amount: 12.99, frequency: 'Monthly',  category: 'Entertainment',  dueDay: 1,  active: true },
      { id: 'b06', name: 'Gym Membership', amount: 45,    frequency: 'Monthly',  category: 'Health',         dueDay: 1,  active: true },
      { id: 'b07', name: 'Car Insurance',  amount: 720,   frequency: 'Annual',   category: 'Insurance',      dueDay: 15, active: true },
      { id: 'b08', name: 'Transit Pass',   amount: 85,    frequency: 'Monthly',  category: 'Transportation', dueDay: 1,  active: true },
    ]
    const today = new Date().toISOString().slice(0, 10)
    const all = loadLS('finance_bills', DEFAULT_BILLS)
      .filter(b => b.active && (!b.endDate || b.endDate >= today))
    const totalMonthly = all.reduce((s, b) => s + toMonthly(b.amount, b.frequency), 0)
    const upcoming = [...all]
      .map(b => ({ ...b, due: nextDueDate(b.dueDay), days: daysUntil(nextDueDate(b.dueDay)) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 4)
    return { totalMonthly, upcoming }
  }, [])

  const goals = useMemo(() => {
    const DEFAULT_GOALS = [
      { id: 'g01', name: 'Emergency Fund',  type: 'Emergency',  targetAmount: 10000, savedAmount: 5200, targetDate: '' },
      { id: 'g02', name: 'Summer Vacation', type: 'Vacation',   targetAmount: 3000,  savedAmount: 900,  targetDate: '2026-08-01' },
      { id: 'g03', name: 'New Laptop',      type: 'Other',      targetAmount: 1500,  savedAmount: 450,  targetDate: '2026-06-01' },
    ]
    const TYPE_COLOR = {
      Vacation: '#0ea5e9', Home: '#6366f1', Car: '#f59e0b',
      Education: '#8b5cf6', Emergency: '#ef4444', Retirement: '#10b981', Other: '#94a3b8',
    }
    const TYPE_EMOJI = {
      Vacation: '🏖️', Home: '🏠', Car: '🚗',
      Education: '🎓', Emergency: '🛡️', Retirement: '🌅', Other: '⭐',
    }
    return loadLS('finance_savings_goals', DEFAULT_GOALS).map(g => ({
      ...g,
      pct:   g.targetAmount > 0 ? Math.min(1, g.savedAmount / g.targetAmount) : 0,
      color: TYPE_COLOR[g.type] || '#94a3b8',
      emoji: TYPE_EMOJI[g.type] || '⭐',
    }))
  }, [])

  // ── Row 4: Recent transactions ──────────────────────────────
  const recent = useMemo(() =>
    [...transactions]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5),
    [transactions]
  )

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Emergency fund status color
  const efColor = emergency.pct >= 1 ? '#059669' : emergency.pct >= 0.5 ? '#7c3aed' : emergency.pct >= 0.25 ? '#d97706' : '#dc2626'

  return (
    <div className="db-grid">

      {/* ── Row 1: Summary cards ── */}
      <div className="db-summary-row">
        <SummaryCard
          label={`${MONTH_FULL[month - 1]} Income`}
          value={fmtFull(income)}
          bold="#059669"
        />
        <SummaryCard
          label={`${MONTH_FULL[month - 1]} Expenses`}
          value={fmtFull(expenses)}
          bold="#ef4444"
        />
        <SummaryCard
          label="Net This Month"
          value={fmtFull(net)}
          bold={net >= 0 ? '#059669' : '#ef4444'}
          sub={net >= 0 ? 'Positive cash flow' : 'Spending exceeds income'}
        />
        <SummaryCard
          label="Net Worth"
          value={fmt(netWorth)}
          bold={netWorth >= 0 ? 'var(--primary)' : '#ef4444'}
          sub="Assets minus liabilities"
        />
      </div>

      {/* ── Row 2: Trend chart ── */}
      <div className="card db-trend-card">
        <h2 className="db-section-title">Income vs Expenses — Last 6 Months</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trendData} barCategoryGap="30%" barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--bg)' }} />
            <Bar dataKey="Income"   fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="Expenses" fill="#f87171" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="db-trend-legend">
          <span><span className="db-legend-dot" style={{ background: '#10b981' }} />Income</span>
          <span><span className="db-legend-dot" style={{ background: '#f87171' }} />Expenses</span>
        </div>
      </div>

      {/* ── Row 3: Widgets ── */}
      <div className="db-widgets-row">

        {/* Emergency Fund */}
        <div className="card db-widget">
          <h3 className="db-widget-title">Emergency Fund</h3>
          <div className="db-widget-main">
            <span className="db-widget-big" style={{ color: efColor }}>
              {(emergency.pct * 100).toFixed(0)}%
            </span>
            <span className="db-widget-sub">funded</span>
          </div>
          <div className="db-progress-track">
            <div className="db-progress-fill" style={{ width: `${emergency.pct * 100}%`, background: efColor }} />
          </div>
          <div className="db-widget-meta">
            <span>{fmt(emergency.balance)} saved</span>
            <span>{emergency.covered.toFixed(1)} of {emergency.months} months</span>
          </div>
        </div>

        {/* Upcoming Bills */}
        <div className="card db-widget">
          <h3 className="db-widget-title">Bills</h3>
          <div className="db-widget-main">
            <span className="db-widget-big" style={{ color: 'var(--primary)' }}>{fmt(bills.totalMonthly)}</span>
            <span className="db-widget-sub">/month</span>
          </div>
          <div className="db-bill-list">
            {bills.upcoming.map(b => (
              <div key={b.id} className="db-bill-row">
                <span className="db-bill-name">{b.name}</span>
                <span className="db-bill-meta">
                  {b.days === 0 ? 'Today' : b.days === 1 ? 'Tomorrow' : `in ${b.days}d`}
                </span>
                <span className="db-bill-amount">{fmt(toMonthly(b.amount, b.frequency))}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Savings Goals */}
        <div className="card db-widget">
          <h3 className="db-widget-title">Savings Goals</h3>
          {goals.length === 0
            ? <p className="db-empty">No goals yet.</p>
            : (
              <div className="db-goals-list">
                {goals.slice(0, 4).map(g => (
                  <div key={g.id} className="db-goal-row">
                    <div className="db-goal-header">
                      <span className="db-goal-name">{g.emoji} {g.name}</span>
                      <span className="db-goal-pct" style={{ color: g.color }}>{(g.pct * 100).toFixed(0)}%</span>
                    </div>
                    <div className="db-progress-track">
                      <div className="db-progress-fill" style={{ width: `${g.pct * 100}%`, background: g.color }} />
                    </div>
                    <div className="db-goal-amounts">
                      <span>{fmt(g.savedAmount)}</span>
                      <span className="db-goal-target">of {fmt(g.targetAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>

      </div>

      {/* ── Row 4: Recent Activity ── */}
      <div className="card db-recent-card">
        <h2 className="db-section-title">Recent Activity</h2>
        {recent.length === 0
          ? <p className="db-empty">No transactions yet.</p>
          : (
            <div className="db-recent-list">
              {recent.map(tx => (
                <div key={tx.id} className="db-recent-row">
                  <div className="db-recent-left">
                    <span className={`db-recent-dot ${tx.type}`} />
                    <div>
                      <span className="db-recent-desc">{tx.description}</span>
                      <span className="db-recent-cat">{tx.category}</span>
                    </div>
                  </div>
                  <div className="db-recent-right">
                    <span className={`db-recent-amount ${tx.type}`}>
                      {tx.type === 'income' ? '+' : '−'}{fmtFull(tx.amount)}
                    </span>
                    <span className="db-recent-date">{fmtDate(tx.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

    </div>
  )
}
