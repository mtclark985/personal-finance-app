import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const EF_KEY     = 'sage_emergency'
const BUDGET_KEY = 'finance_budget'

function readBudgetExpenses() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    if (!s) return null
    const b = JSON.parse(s)
    const fixed = (b.fixedExpenses  || []).reduce((sum, r) => sum + (r.amount || 0), 0)
    const disc  = (b.discretionary  || []).reduce((sum, r) => sum + (r.amount || 0), 0)
    return Math.round(fixed + disc)
  } catch { return null }
}

const DEFAULTS = {
  currentBalance:      5_000,
  targetMonths:        6,
  monthlyExpenses:     3_500,
  monthlyContribution: 500,
  autoSync:            true,
  // history: array of { date: 'YYYY-MM', balance }
  history: [],
}

function load() {
  try {
    const s = localStorage.getItem(EF_KEY)
    if (s) return { ...DEFAULTS, ...JSON.parse(s) }
    return DEFAULTS
  } catch { return DEFAULTS }
}

function fmt(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function formatMonth(date) {
  return date.toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

// ── Status config ─────────────────────────────────────────────
function getStatus(pct) {
  if (pct >= 1)    return { label: 'Fully Funded',  sub: 'Your emergency fund meets your target. Great work!',                 color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '✓' }
  if (pct >= 0.75) return { label: 'Nearly There',  sub: 'You\'re in great shape — just a little more to hit your goal.',     color: '#0284c7', bg: '#eff6ff', border: '#bae6fd', icon: '↑' }
  if (pct >= 0.50) return { label: 'Making Progress', sub: 'Halfway there! Keep contributing consistently.',                  color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: '→' }
  if (pct >= 0.25) return { label: 'Building Up',   sub: 'Good start — a small, steady contribution goes a long way.',        color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '~' }
  return             { label: 'Just Getting Started', sub: 'Even $500–$1,000 provides meaningful protection. Start small.', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '!' }
}

// ── NumInput ──────────────────────────────────────────────────
function NumInput({ value, onChange, prefix = '$', suffix = '', step = 100, min = 0, wide }) {
  return (
    <div className="nw-num-wrap" style={{ width: wide ? '140px' : 'fit-content' }}>
      {prefix && <span className="nw-prefix">{prefix}</span>}
      <input className="nw-num-input" type="number" min={min} step={step}
        value={value || ''} placeholder="0"
        style={{ width: wide ? '100px' : '80px' }}
        onChange={e => onChange(parseFloat(e.target.value) || 0)} />
      {suffix && <span className="nw-suffix">{suffix}</span>}
    </div>
  )
}

export default function EmergencyFund() {
  const [d, setD] = useState(load)

  useEffect(() => {
    localStorage.setItem(EF_KEY, JSON.stringify(d))
    setAppData('emergency_fund', d).catch(console.error)
  }, [d])

  // Auto-sync expenses from budget planner
  const budgetExpenses = useMemo(() => readBudgetExpenses(), [])
  useEffect(() => {
    if (d.autoSync && budgetExpenses) {
      setD(prev => ({ ...prev, monthlyExpenses: budgetExpenses }))
    }
  }, [d.autoSync, budgetExpenses]) // eslint-disable-line

  function set(field, val) { setD(prev => ({ ...prev, [field]: val })) }

  // ── Core calculations ─────────────────────────────────────
  const calc = useMemo(() => {
    const target  = d.targetMonths * d.monthlyExpenses
    const balance = Math.max(0, d.currentBalance)
    const gap     = Math.max(0, target - balance)
    const pct     = target > 0 ? Math.min(1, balance / target) : 0
    const contrib = Math.max(1, d.monthlyContribution)

    // Months to goal
    const monthsToGoal = gap > 0 ? Math.ceil(gap / contrib) : 0
    const goalDate     = addMonths(new Date(), monthsToGoal)

    // Build projection chart: today → goal reached (or 36 months max)
    const chartMonths = Math.min(Math.max(monthsToGoal + 3, 12), 60)
    const projection  = []
    for (let i = 0; i <= chartMonths; i++) {
      const b = Math.min(balance + contrib * i, target * 1.05) // cap slightly above goal
      projection.push({
        month:   formatMonth(addMonths(new Date(), i)),
        balance: Math.round(b),
        target:  Math.round(target),
      })
    }

    // Coverage breakdown (how many months covered at each tier)
    const coverageMonths = target > 0 ? (balance / d.monthlyExpenses) : 0

    return { target, balance, gap, pct, monthsToGoal, goalDate, projection, coverageMonths, contrib }
  }, [d])

  const status = getStatus(calc.pct)

  // ── Milestone thresholds ──────────────────────────────────
  const milestones = [
    { label: '1 month',   months: 1 },
    { label: '3 months',  months: 3 },
    { label: '6 months',  months: 6 },
    { label: '9 months',  months: 9 },
    { label: '12 months', months: 12 },
  ].filter(m => m.months <= d.targetMonths + 3)

  // History management
  function logCurrentBalance() {
    const now    = new Date()
    const key    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const exists = d.history.some(h => h.date === key)
    if (exists) {
      setD(prev => ({ ...prev, history: prev.history.map(h => h.date === key ? { ...h, balance: d.currentBalance } : h) }))
    } else {
      setD(prev => ({ ...prev, history: [...prev.history, { date: key, balance: d.currentBalance }].sort((a, b) => a.date.localeCompare(b.date)) }))
    }
  }

  const historyChartData = d.history.map(h => ({
    month:   h.date,
    balance: h.balance,
    target:  calc.target,
  }))

  return (
    <div className="ef-page">

      {/* ── Health Banner ── */}
      <div className="ef-banner" style={{ background: status.bg, borderColor: status.border }}>
        <div className="ef-banner-icon" style={{ background: status.color }}>{status.icon}</div>
        <div className="ef-banner-body">
          <span className="ef-banner-label" style={{ color: status.color }}>{status.label}</span>
          <span className="ef-banner-sub">{status.sub}</span>
        </div>
        <div className="ef-banner-pct" style={{ color: status.color }}>
          {(calc.pct * 100).toFixed(0)}%
        </div>
      </div>

      {/* ── Top grid: Goal Setup + Progress ── */}
      <div className="ef-top-grid">

        {/* Goal Setup */}
        <div className="card rc-card">
          <div className="rc-card-head">
            <h2>Goal Setup</h2>
            {budgetExpenses !== null && (
              <label className="rc-sync-toggle">
                <input type="checkbox" checked={d.autoSync}
                  onChange={e => set('autoSync', e.target.checked)} />
                Sync from Budget
              </label>
            )}
          </div>
          <div className="rc-fields">
            <div className="rc-field">
              <label className="rc-label">Current Balance</label>
              <NumInput value={d.currentBalance} step={100} wide onChange={v => set('currentBalance', v)} />
            </div>
            <div className="rc-field">
              <label className="rc-label">Monthly Expenses</label>
              <span className="rc-hint">{d.autoSync && budgetExpenses ? 'Synced from Budget Planner' : 'Fixed + discretionary spending'}</span>
              <NumInput value={d.monthlyExpenses} step={100} wide
                onChange={v => set('monthlyExpenses', v)} />
            </div>
            <div className="rc-field">
              <label className="rc-label">Target Coverage</label>
              <span className="rc-hint">Recommended: 3–6 months (more if self-employed)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                <input type="range" min={1} max={12} step={1}
                  value={d.targetMonths}
                  className="ef-range"
                  onChange={e => set('targetMonths', parseInt(e.target.value))} />
                <span className="ef-range-val">{d.targetMonths} mo</span>
              </div>
            </div>
            <div className="rc-field">
              <label className="rc-label">Monthly Contribution</label>
              <NumInput value={d.monthlyContribution} step={50} wide onChange={v => set('monthlyContribution', v)} />
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="card rc-card">
          <h2>Progress</h2>

          {/* Big number */}
          <div className="ef-progress-header">
            <div>
              <div className="ef-eyebrow">Current Balance</div>
              <div className="ef-big-num" style={{ color: status.color }}>{fmt(calc.balance)}</div>
              <div className="ef-progress-sub">of {fmt(calc.target)} goal</div>
            </div>
            <div className="ef-coverage-badge" style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>
              <span className="ef-coverage-num">{calc.coverageMonths.toFixed(1)}</span>
              <span className="ef-coverage-label">months covered</span>
            </div>
          </div>

          {/* Progress bar with milestones */}
          <div className="ef-bar-outer">
            <div className="ef-bar-track">
              <div className="ef-bar-fill" style={{ width: `${calc.pct * 100}%`, background: status.color }} />
            </div>
            {/* Milestone ticks */}
            <div className="ef-milestone-row">
              {milestones.map(m => {
                const pct = calc.target > 0 ? Math.min(1, (m.months * d.monthlyExpenses) / calc.target) * 100 : 0
                const reached = calc.balance >= m.months * d.monthlyExpenses
                return (
                  <div key={m.months} className="ef-milestone" style={{ left: `${pct}%` }}>
                    <div className={`ef-milestone-tick ${reached ? 'reached' : ''}`} style={{ background: reached ? status.color : undefined }} />
                    <div className="ef-milestone-label">{m.label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Key stats */}
          <div className="ef-stats-row">
            <div className="ef-stat">
              <span>Gap to Goal</span>
              <strong style={{ color: calc.gap > 0 ? '#dc2626' : '#059669' }}>
                {calc.gap > 0 ? fmt(calc.gap) : 'Reached!'}
              </strong>
            </div>
            <div className="ef-stat">
              <span>Monthly Contribution</span>
              <strong>{fmt(calc.contrib)}</strong>
            </div>
            <div className="ef-stat">
              <span>{calc.monthsToGoal > 0 ? 'Months to Goal' : 'Goal Status'}</span>
              <strong style={{ color: calc.monthsToGoal === 0 ? '#059669' : undefined }}>
                {calc.monthsToGoal > 0 ? `${calc.monthsToGoal} mo` : 'Funded!'}
              </strong>
            </div>
            <div className="ef-stat">
              <span>{calc.monthsToGoal > 0 ? 'Target Date' : 'Fully Funded'}</span>
              <strong>
                {calc.monthsToGoal > 0
                  ? calc.goalDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                  : '✓'}
              </strong>
            </div>
          </div>
        </div>

      </div>

      {/* ── Projection Chart ── */}
      <div className="card rc-card">
        <h2>Savings Projection</h2>
        <p className="bp-subtitle">
          At {fmt(calc.contrib)}/mo,
          {calc.monthsToGoal > 0
            ? ` you'll reach your ${fmt(calc.target)} goal in ${calc.monthsToGoal} months (${calc.goalDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}).`
            : ' your emergency fund is fully funded!'}
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={calc.projection} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="efGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={status.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={status.color} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              interval={Math.floor(calc.projection.length / 5)} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="cf-tooltip">
                    <strong>{payload[0]?.payload?.month}</strong>
                    <span style={{ color: status.color }}>Balance: {fmt(payload[0]?.value)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>Goal: {fmt(payload[1]?.value)}</span>
                  </div>
                )
              }}
            />
            <ReferenceLine y={calc.target} stroke="#94a3b8" strokeDasharray="6 3"
              label={{ value: 'Goal', position: 'right', fontSize: 11, fill: '#94a3b8' }} />
            <Area type="monotone" dataKey="balance" stroke={status.color} strokeWidth={2}
              fill="url(#efGrad)" dot={false} name="Balance" />
            <Area type="monotone" dataKey="target" stroke="transparent" fill="none" name="Goal" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Scenario Comparison ── */}
      <div className="card rc-card">
        <h2>Contribution Scenarios</h2>
        <p className="bp-subtitle">How different monthly savings amounts affect your timeline.</p>
        <div className="ef-scenario-grid">
          {[
            { label: 'Minimum',   pct: 0.5  },
            { label: 'Current',   pct: 1    },
            { label: 'Aggressive', pct: 1.5 },
            { label: 'Turbo',     pct: 2    },
          ].map(s => {
            const contrib = Math.max(50, Math.round(calc.contrib * s.pct / 50) * 50)
            const months  = calc.gap > 0 ? Math.ceil(calc.gap / contrib) : 0
            const date    = addMonths(new Date(), months)
            const isActive = contrib === calc.contrib
            return (
              <div key={s.label} className={`ef-scenario-col ${isActive ? 'ef-scenario-active' : ''}`}
                onClick={() => set('monthlyContribution', contrib)}
                style={{ cursor: 'pointer' }}>
                <div className="ef-scenario-label">{s.label}</div>
                <div className="ef-scenario-contrib">{fmt(contrib)}<span>/mo</span></div>
                <div className="ef-scenario-months">
                  {months > 0 ? `${months} months` : 'Already funded'}
                </div>
                {months > 0 && (
                  <div className="ef-scenario-date">
                    {date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="bp-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>Click a scenario to apply it.</p>
      </div>

      {/* ── Balance History ── */}
      <div className="card rc-card">
        <div className="rc-card-head" style={{ marginBottom: 12 }}>
          <h2>Balance History</h2>
          <button className="ef-log-btn" onClick={logCurrentBalance}>
            Log Current Balance
          </button>
        </div>
        {d.history.length === 0 ? (
          <p className="bp-subtitle">No history yet. Click "Log Current Balance" to start tracking your progress over time.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={historyChartData} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={40} />
                <Tooltip formatter={(v) => [fmt(v), '']} />
                <ReferenceLine y={calc.target} stroke="#94a3b8" strokeDasharray="4 2" />
                <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2}
                  fill="url(#histGrad)" dot={{ r: 4, fill: '#6366f1' }} name="Balance" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="ef-history-table-wrap">
              <table className="cf-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Month</th>
                    <th>Balance</th>
                    <th>Coverage</th>
                    <th>% of Goal</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...d.history].reverse().map(h => (
                    <tr key={h.date}>
                      <td style={{ textAlign: 'left', fontWeight: 500 }}>{h.date}</td>
                      <td className="cf-income">{fmt(h.balance)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {d.monthlyExpenses > 0 ? `${(h.balance / d.monthlyExpenses).toFixed(1)} mo` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {calc.target > 0 ? `${((h.balance / calc.target) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td>
                        <button className="bp-delete" onClick={() =>
                          setD(prev => ({ ...prev, history: prev.history.filter(x => x.date !== h.date) }))
                        }>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Tips ── */}
      <div className="card rc-card ef-tips-card">
        <h2>Guidance</h2>
        <div className="ef-tips">
          {calc.pct < 1 && (
            <div className="ef-tip">
              <span className="ef-tip-icon">💡</span>
              <div>
                <strong>Where to keep it:</strong> High-yield savings account (HYSA) or money market fund.
                Target 4–5% APY. Avoid CDs or investments — you need instant access.
              </div>
            </div>
          )}
          {calc.pct < 0.5 && (
            <div className="ef-tip">
              <span className="ef-tip-icon">🎯</span>
              <div>
                <strong>First milestone:</strong> Aim for 1 month of expenses ({fmt(d.monthlyExpenses)}) first.
                Even a small buffer prevents most financial emergencies from becoming crises.
              </div>
            </div>
          )}
          {d.monthlyContribution < d.monthlyExpenses * 0.05 && calc.gap > 0 && (
            <div className="ef-tip">
              <span className="ef-tip-icon">⚡</span>
              <div>
                <strong>Boost your rate:</strong> Contributing less than 5% of monthly expenses.
                Try automating a transfer on payday — even an extra {fmt(Math.round(d.monthlyExpenses * 0.05))} /mo
                saves {Math.round(calc.gap / Math.max(1, d.monthlyContribution + d.monthlyExpenses * 0.05))} fewer months.
              </div>
            </div>
          )}
          {calc.coverageMonths >= 3 && calc.coverageMonths < 6 && (
            <div className="ef-tip">
              <span className="ef-tip-icon">🛡️</span>
              <div>
                <strong>3 months reached:</strong> You've hit the minimum recommended level.
                Consider pushing to 6 months if you're self-employed, have variable income, or support dependents.
              </div>
            </div>
          )}
          {calc.pct >= 1 && (
            <div className="ef-tip">
              <span className="ef-tip-icon">🎉</span>
              <div>
                <strong>Goal achieved!</strong> Now redirect that {fmt(d.monthlyContribution)}/mo toward investing,
                extra debt payoff, or increasing your retirement contributions.
              </div>
            </div>
          )}
          <div className="ef-tip">
            <span className="ef-tip-icon">📋</span>
            <div>
              <strong>What counts as an emergency:</strong> Job loss, medical bills, urgent home/car repairs,
              unexpected travel for family. Vacations and discretionary purchases do not.
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
