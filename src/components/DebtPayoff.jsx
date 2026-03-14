import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'

const DEBT_KEY = 'sage_debtpayoff'

const DEBT_TYPES = [
  { key: 'credit_card',    label: 'Credit Card',    color: '#ef4444' },
  { key: 'student_loan',   label: 'Student Loan',   color: '#8b5cf6' },
  { key: 'auto',           label: 'Auto Loan',      color: '#3b82f6' },
  { key: 'personal',       label: 'Personal Loan',  color: '#f97316' },
  { key: 'medical',        label: 'Medical',        color: '#06b6d4' },
  { key: 'other',          label: 'Other',          color: '#94a3b8' },
]
const TYPE_MAP = Object.fromEntries(DEBT_TYPES.map(t => [t.key, t]))

const DEBT_COLORS = ['#6366f1','#ec4899','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6','#06b6d4']

const DEFAULT_DEBTS = [
  { id: 'db1', name: 'Visa Credit Card',     type: 'credit_card',  balance: 5_400,  rate: 22.99, minPayment: 108  },
  { id: 'db2', name: 'Discover Card',        type: 'credit_card',  balance: 2_100,  rate: 18.99, minPayment: 42   },
  { id: 'db3', name: 'Car Loan',             type: 'auto',         balance: 14_500, rate: 6.5,   minPayment: 285  },
  { id: 'db4', name: 'Federal Student Loan', type: 'student_loan', balance: 28_000, rate: 5.75,  minPayment: 310  },
  { id: 'db5', name: 'Personal Loan',        type: 'personal',     balance: 3_200,  rate: 12.5,  minPayment: 95   },
]

const DEFAULTS = {
  debts:         DEFAULT_DEBTS,
  extraPayment:  300,
  strategy:      'avalanche',   // 'snowball' | 'avalanche' | 'custom'
  customOrder:   DEFAULT_DEBTS.map(d => d.id),
}

function load() {
  try {
    const s = localStorage.getItem(DEBT_KEY)
    if (s) {
      const p = JSON.parse(s)
      return { ...DEFAULTS, ...p }
    }
    return DEFAULTS
  } catch { return DEFAULTS }
}

function fmt(n)    { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmtFull(n){ return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) }
function addMonths(n) {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── Core payoff simulator ──────────────────────────────────────
function simulate(debts, extraPayment, strategy, customOrder) {
  if (!debts.length) return null

  // Build priority order
  let priority
  if (strategy === 'snowball')  priority = [...debts].sort((a, b) => a.balance - b.balance)
  else if (strategy === 'avalanche') priority = [...debts].sort((a, b) => b.rate - a.rate)
  else {
    const idx = Object.fromEntries((customOrder || debts.map(d => d.id)).map((id, i) => [id, i]))
    priority = [...debts].sort((a, b) => (idx[a.id] ?? 99) - (idx[b.id] ?? 99))
  }

  const bal = Object.fromEntries(debts.map(d => [d.id, d.balance]))
  const payoffMonth = {}
  let totalInterest = 0
  const history = []

  for (let month = 1; month <= 720; month++) {
    // Apply interest
    debts.forEach(d => {
      if (bal[d.id] > 0.005) {
        const i = bal[d.id] * (d.rate / 100 / 12)
        bal[d.id] += i
        totalInterest += i
      }
    })

    // Pay minimums; freed minimums (from paid debts) flow into pool
    let pool = Math.max(0, extraPayment)
    debts.forEach(d => {
      if (bal[d.id] > 0.005) {
        const pay = Math.min(d.minPayment, bal[d.id])
        bal[d.id] = Math.max(0, bal[d.id] - pay)
        pool += Math.max(0, d.minPayment - pay) // overshoot goes to pool
        if (bal[d.id] < 0.005) {
          bal[d.id] = 0
          if (payoffMonth[d.id] == null) payoffMonth[d.id] = month
        }
      } else {
        pool += d.minPayment // full minimum rolls over
      }
    })

    // Pour pool into priority debts in order
    for (const d of priority) {
      if (pool < 0.005) break
      if (bal[d.id] > 0.005) {
        const pay = Math.min(pool, bal[d.id])
        bal[d.id] = Math.max(0, bal[d.id] - pay)
        pool -= pay
        if (bal[d.id] < 0.005) {
          bal[d.id] = 0
          if (payoffMonth[d.id] == null) payoffMonth[d.id] = month
        }
      }
    }

    // Snapshot every 3 months (and always month 1)
    if (month === 1 || month % 3 === 0) {
      const snap = { month }
      debts.forEach(d => { snap[d.id] = Math.round(Math.max(0, bal[d.id])) })
      snap.total = debts.reduce((s, d) => s + Math.max(0, bal[d.id]), 0)
      history.push(snap)
    }

    if (debts.every(d => bal[d.id] < 0.005)) {
      // Make sure final zero point is recorded
      const last = history[history.length - 1]
      if (!last || last.total > 0) {
        const snap = { month }
        debts.forEach(d => { snap[d.id] = 0 })
        snap.total = 0
        history.push(snap)
      }
      break
    }
  }

  const maxMonth = Object.values(payoffMonth).length
    ? Math.max(...Object.values(payoffMonth)) : 0

  return {
    months: maxMonth,
    totalInterest: Math.round(totalInterest),
    payoffMonth,
    history,
    priority,
  }
}

// Minimum-only simulation (no extra)
function simulateMinOnly(debts) {
  return simulate(debts, 0, 'avalanche', [])
}

// ── Sub-components ─────────────────────────────────────────────
function StrategyCard({ label, icon, color, bg, result, minResult, debtColors, debts }) {
  if (!result) return null
  const saved = minResult ? minResult.totalInterest - result.totalInterest : 0
  const monthsSaved = minResult ? minResult.months - result.months : 0
  return (
    <div className="dp-strategy-card" style={{ borderTopColor: color }}>
      <div className="dp-strat-header">
        <span className="dp-strat-icon" style={{ background: bg, color }}>{icon}</span>
        <div>
          <div className="dp-strat-label" style={{ color }}>{label}</div>
          <div className="dp-strat-sub">Debt-free {addMonths(result.months)}</div>
        </div>
      </div>
      <div className="dp-strat-stats">
        <div className="dp-strat-stat">
          <span>Payoff Time</span>
          <strong>{Math.floor(result.months / 12)}y {result.months % 12}m</strong>
        </div>
        <div className="dp-strat-stat">
          <span>Total Interest</span>
          <strong style={{ color: '#dc2626' }}>{fmt(result.totalInterest)}</strong>
        </div>
        {saved > 0 && (
          <div className="dp-strat-stat">
            <span>vs. Min Only</span>
            <strong style={{ color: '#059669' }}>Save {fmt(saved)}</strong>
          </div>
        )}
        {monthsSaved > 0 && (
          <div className="dp-strat-stat">
            <span>Months Faster</span>
            <strong style={{ color: '#059669' }}>{monthsSaved} mo</strong>
          </div>
        )}
      </div>
      {/* Payoff order */}
      <div className="dp-payoff-order">
        {result.priority.map((d, i) => {
          const mo = result.payoffMonth[d.id]
          return (
            <div key={d.id} className="dp-order-row">
              <span className="dp-order-num" style={{ background: debtColors[debts.findIndex(x => x.id === d.id) % debtColors.length] }}>
                {i + 1}
              </span>
              <span className="dp-order-name">{d.name}</span>
              <span className="dp-order-date">{mo ? addMonths(mo) : '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────
export default function DebtPayoff() {
  const [d, setD] = useState(load)

  useEffect(() => {
    localStorage.setItem(DEBT_KEY, JSON.stringify(d))
    setAppData('debt_payoff', d).catch(console.error)
  }, [d])

  function set(field, val) { setD(prev => ({ ...prev, [field]: val })) }

  function addDebt() {
    const id = crypto.randomUUID()
    setD(prev => ({
      ...prev,
      debts: [...prev.debts, { id, name: '', type: 'credit_card', balance: 0, rate: 0, minPayment: 0 }],
      customOrder: [...(prev.customOrder || []), id],
    }))
  }
  function updateDebt(id, field, val) {
    setD(prev => ({ ...prev, debts: prev.debts.map(db => db.id === id ? { ...db, [field]: val } : db) }))
  }
  function deleteDebt(id) {
    setD(prev => ({
      ...prev,
      debts: prev.debts.filter(db => db.id !== id),
      customOrder: (prev.customOrder || []).filter(x => x !== id),
    }))
  }
  function moveDebt(id, dir) {
    setD(prev => {
      const order = [...(prev.customOrder || prev.debts.map(db => db.id))]
      const i = order.indexOf(id)
      if (i < 0) return prev
      const j = i + dir
      if (j < 0 || j >= order.length) return prev
      ;[order[i], order[j]] = [order[j], order[i]]
      return { ...prev, customOrder: order, strategy: 'custom' }
    })
  }

  const validDebts = d.debts.filter(db => db.balance > 0 && db.rate >= 0 && db.minPayment > 0)

  // ── Simulations ───────────────────────────────────────────
  const results = useMemo(() => {
    if (!validDebts.length) return {}
    return {
      snowball: simulate(validDebts, d.extraPayment, 'snowball', d.customOrder),
      avalanche: simulate(validDebts, d.extraPayment, 'avalanche', d.customOrder),
      custom: d.strategy === 'custom' ? simulate(validDebts, d.extraPayment, 'custom', d.customOrder) : null,
      minOnly: simulateMinOnly(validDebts),
    }
  }, [validDebts, d.extraPayment, d.strategy, d.customOrder]) // eslint-disable-line

  // ── Chart data: merge snowball + avalanche + minOnly timelines ──
  const chartData = useMemo(() => {
    const s = results.snowball
    const a = results.avalanche
    const m = results.minOnly
    if (!s && !a) return []

    const maxMonth = Math.max(
      s?.months ?? 0,
      a?.months ?? 0,
      m?.months ?? 0,
    )

    // Build lookup maps by month
    function buildMap(sim) {
      const map = {}
      if (!sim) return map
      sim.history.forEach(h => { map[h.month] = h.total })
      return map
    }
    const sMap = buildMap(s)
    const aMap = buildMap(a)
    const mMap = buildMap(m)

    function interp(map, month, maxMo) {
      if (month > maxMo) return 0
      if (map[month] != null) return map[month]
      // linear interpolation between surrounding snapshots
      const keys = Object.keys(map).map(Number).sort((x, y) => x - y)
      for (let i = 0; i < keys.length - 1; i++) {
        if (keys[i] <= month && month <= keys[i + 1]) {
          const t = (month - keys[i]) / (keys[i + 1] - keys[i])
          return Math.round(map[keys[i]] + t * (map[keys[i + 1]] - map[keys[i]]))
        }
      }
      return 0
    }

    const points = []
    for (let mo = 0; mo <= maxMonth; mo += 3) {
      const pt = { month: mo, label: mo === 0 ? 'Now' : `Mo ${mo}` }
      if (s) pt.snowball  = interp(sMap, mo, s.months)
      if (a) pt.avalanche = interp(aMap, mo, a.months)
      if (m) pt.minOnly   = interp(mMap, mo, m.months)
      points.push(pt)
    }
    // ensure zero endpoints
    if (s && points[points.length - 1]?.snowball > 0)  points.push({ month: s.months,  label: `Mo ${s.months}`,  snowball: 0, avalanche: interp(aMap, s.months, a?.months ?? 0), minOnly: interp(mMap, s.months, m?.months ?? 0) })
    if (a && points[points.length - 1]?.avalanche > 0) points.push({ month: a.months,  label: `Mo ${a.months}`,  snowball: 0, avalanche: 0, minOnly: interp(mMap, a.months, m?.months ?? 0) })
    return points.sort((x, y) => x.month - y.month)
  }, [results])

  // ── Gantt chart data ──────────────────────────────────────
  const ganttData = useMemo(() => {
    const active = d.strategy === 'avalanche' ? results.avalanche
                 : d.strategy === 'snowball'  ? results.snowball
                 : results.custom || results.avalanche
    if (!active) return []
    const maxMo = active.months || 1
    return validDebts.map((debt, i) => ({
      ...debt,
      color: DEBT_COLORS[i % DEBT_COLORS.length],
      payoffMonth: active.payoffMonth[debt.id] || maxMo,
      pct: ((active.payoffMonth[debt.id] || maxMo) / maxMo) * 100,
    })).sort((a, b) => a.payoffMonth - b.payoffMonth)
  }, [results, d.strategy, validDebts])

  const totalBalance = validDebts.reduce((s, db) => s + db.balance, 0)
  const totalMinPayment = validDebts.reduce((s, db) => s + db.minPayment, 0)
  const activeResult = d.strategy === 'snowball' ? results.snowball
                     : d.strategy === 'custom'   ? (results.custom || results.avalanche)
                     : results.avalanche

  return (
    <div className="dp-page">

      {/* ── Summary Banner ── */}
      {activeResult && (
        <div className="dp-banner">
          <div className="dp-banner-block">
            <span>Total Debt</span>
            <strong style={{ color: '#dc2626' }}>{fmt(totalBalance)}</strong>
          </div>
          <div className="dp-banner-block">
            <span>Monthly Payment</span>
            <strong>{fmt(totalMinPayment + d.extraPayment)}</strong>
          </div>
          <div className="dp-banner-block">
            <span>Debt-Free Date</span>
            <strong style={{ color: '#6366f1' }}>{addMonths(activeResult.months)}</strong>
          </div>
          <div className="dp-banner-block">
            <span>Total Interest</span>
            <strong style={{ color: '#f97316' }}>{fmt(activeResult.totalInterest)}</strong>
          </div>
          {results.minOnly && (
            <div className="dp-banner-block">
              <span>Interest Saved vs Min</span>
              <strong style={{ color: '#059669' }}>
                {fmt(Math.max(0, results.minOnly.totalInterest - activeResult.totalInterest))}
              </strong>
            </div>
          )}
        </div>
      )}

      {/* ── Debts table + Strategy ── */}
      <div className="dp-top-grid">

        {/* Debt list */}
        <div className="card rc-card">
          <div className="rc-card-head" style={{ marginBottom: 12 }}>
            <h2>Your Debts</h2>
            <button className="ef-log-btn" onClick={addDebt}>+ Add Debt</button>
          </div>
          <div className="dp-table-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Balance</th>
                  <th>APR %</th>
                  <th>Min Pmt</th>
                  <th>Min %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.debts.map((db, i) => {
                  const typeInfo = TYPE_MAP[db.type] || TYPE_MAP.other
                  const minPct   = db.balance > 0 ? ((db.minPayment / db.balance) * 100).toFixed(1) : '—'
                  return (
                    <tr key={db.id}>
                      <td>
                        <input className="nw-text-input" value={db.name} placeholder="e.g. Visa Card"
                          onChange={e => updateDebt(db.id, 'name', e.target.value)} />
                      </td>
                      <td>
                        <select className="nw-select" value={db.type}
                          onChange={e => updateDebt(db.id, 'type', e.target.value)}>
                          {DEBT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="nw-num-wrap">
                          <span className="nw-prefix">$</span>
                          <input className="nw-num-input" type="number" min={0} step={100}
                            value={db.balance || ''} placeholder="0" style={{ width: 72 }}
                            onChange={e => updateDebt(db.id, 'balance', parseFloat(e.target.value) || 0)} />
                        </div>
                      </td>
                      <td>
                        <div className="nw-num-wrap">
                          <input className="nw-num-input" type="number" min={0} max={100} step={0.1}
                            value={db.rate || ''} placeholder="0" style={{ width: 52 }}
                            onChange={e => updateDebt(db.id, 'rate', parseFloat(e.target.value) || 0)} />
                          <span className="nw-suffix">%</span>
                        </div>
                      </td>
                      <td>
                        <div className="nw-num-wrap">
                          <span className="nw-prefix">$</span>
                          <input className="nw-num-input" type="number" min={0} step={5}
                            value={db.minPayment || ''} placeholder="0" style={{ width: 60 }}
                            onChange={e => updateDebt(db.id, 'minPayment', parseFloat(e.target.value) || 0)} />
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        <span className="inv-ac-dot" style={{ background: DEBT_COLORS[i % DEBT_COLORS.length] }} />
                        {minPct}{minPct !== '—' ? '%' : ''}
                      </td>
                      <td>
                        <button className="nw-delete" onClick={() => deleteDebt(db.id)}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="inv-total-row">
                  <td colSpan={2}>Totals</td>
                  <td><strong>{fmt(totalBalance)}</strong></td>
                  <td>—</td>
                  <td><strong>{fmt(totalMinPayment)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Strategy + Extra payment */}
        <div className="card rc-card">
          <h2>Strategy</h2>

          <div className="dp-strategy-btns">
            {[
              { key: 'avalanche', label: 'Avalanche', icon: '🏔️', desc: 'Highest interest rate first — saves the most money' },
              { key: 'snowball',  label: 'Snowball',  icon: '⛄', desc: 'Lowest balance first — fastest early wins for motivation' },
              { key: 'custom',    label: 'Custom',    icon: '✎',  desc: 'Set your own payoff order below' },
            ].map(s => (
              <button key={s.key} title={s.desc}
                className={`dp-strat-btn ${d.strategy === s.key ? 'active' : ''}`}
                onClick={() => set('strategy', s.key)}>
                <span>{s.icon}</span>
                <span>{s.label}</span>
                <span className="dp-strat-btn-desc">{s.desc}</span>
              </button>
            ))}
          </div>

          <div className="rc-field" style={{ marginTop: 16 }}>
            <label className="rc-label">Extra Monthly Payment</label>
            <span className="rc-hint">On top of minimums — this is your debt-busting fuel</span>
            <div className="nw-num-wrap" style={{ marginTop: 4 }}>
              <span className="nw-prefix">$</span>
              <input className="nw-num-input" type="number" min={0} step={50}
                value={d.extraPayment || ''} placeholder="0" style={{ width: 80 }}
                onChange={e => set('extraPayment', parseFloat(e.target.value) || 0)} />
              <span className="nw-suffix">/mo</span>
            </div>
          </div>

          <div className="dp-payment-summary">
            <div className="dp-pay-row">
              <span>Total minimums</span><span>{fmt(totalMinPayment)}</span>
            </div>
            <div className="dp-pay-row">
              <span>Extra payment</span><span style={{ color: '#059669' }}>+{fmt(d.extraPayment)}</span>
            </div>
            <div className="dp-pay-row dp-pay-total">
              <span>Total monthly</span><strong>{fmt(totalMinPayment + d.extraPayment)}</strong>
            </div>
          </div>

          {/* Custom order */}
          {d.strategy === 'custom' && (
            <div style={{ marginTop: 14 }}>
              <div className="rc-label" style={{ marginBottom: 8 }}>Payoff Order (drag to reorder)</div>
              {(d.customOrder || d.debts.map(db => db.id)).map((id, i) => {
                const debt = d.debts.find(db => db.id === id)
                if (!debt) return null
                return (
                  <div key={id} className="dp-custom-row">
                    <span className="dp-custom-num" style={{ background: DEBT_COLORS[i % DEBT_COLORS.length] }}>{i + 1}</span>
                    <span className="dp-custom-name">{debt.name || 'Unnamed'}</span>
                    <span className="dp-custom-bal">{fmt(debt.balance)}</span>
                    <div className="dp-custom-arrows">
                      <button onClick={() => moveDebt(id, -1)} disabled={i === 0}>↑</button>
                      <button onClick={() => moveDebt(id, 1)} disabled={i === d.debts.length - 1}>↓</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Strategy Comparison Cards ── */}
      {validDebts.length > 0 && (
        <div className="dp-comparison-grid">
          <StrategyCard
            label="Avalanche Method" icon="🏔️" color="#6366f1" bg="#eef2ff"
            result={results.avalanche} minResult={results.minOnly}
            debtColors={DEBT_COLORS} debts={validDebts} />
          <StrategyCard
            label="Snowball Method" icon="⛄" color="#ec4899" bg="#fdf2f8"
            result={results.snowball} minResult={results.minOnly}
            debtColors={DEBT_COLORS} debts={validDebts} />
          {results.minOnly && (
            <StrategyCard
              label="Minimums Only" icon="⚠" color="#94a3b8" bg="#f8fafc"
              result={results.minOnly} minResult={null}
              debtColors={DEBT_COLORS} debts={validDebts} />
          )}
        </div>
      )}

      {/* ── Balance Over Time Chart ── */}
      {chartData.length > 1 && (
        <div className="card rc-card">
          <h2>Total Balance Over Time</h2>
          <p className="bp-subtitle">How your total debt shrinks under each strategy vs. paying minimums only.</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="cf-tooltip">
                      <strong>{label}</strong>
                      {payload.map((p, i) => (
                        <span key={i} style={{ color: p.color }}>
                          {p.name}: {fmt(p.value)}
                        </span>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
              {results.avalanche && <Line type="monotone" dataKey="avalanche" name="Avalanche" stroke="#6366f1" strokeWidth={2.5} dot={false} />}
              {results.snowball  && <Line type="monotone" dataKey="snowball"  name="Snowball"  stroke="#ec4899" strokeWidth={2.5} dot={false} />}
              {results.minOnly   && <Line type="monotone" dataKey="minOnly"   name="Min Only"  stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="5 4" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Debt Payoff Gantt ── */}
      {ganttData.length > 0 && (
        <div className="card rc-card">
          <h2>Payoff Timeline</h2>
          <p className="bp-subtitle">
            Showing order for <strong style={{ textTransform: 'capitalize' }}>{d.strategy}</strong> strategy.
            Each bar ends when that debt reaches $0.
          </p>
          <div className="dp-gantt">
            {ganttData.map((debt, i) => (
              <div key={debt.id} className="dp-gantt-row">
                <div className="dp-gantt-label">
                  <span className="inv-ac-dot" style={{ background: debt.color }} />
                  {debt.name || 'Unnamed'}
                </div>
                <div className="dp-gantt-track">
                  <div className="dp-gantt-bar" style={{ width: `${debt.pct}%`, background: debt.color }} />
                  <span className="dp-gantt-date">{addMonths(debt.payoffMonth)}</span>
                </div>
              </div>
            ))}
            <div className="dp-gantt-axis">
              <span>Now</span>
              <span>{addMonths(Math.round((activeResult?.months || 12) / 2))}</span>
              <span>{addMonths(activeResult?.months || 12)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Extra Payment Impact ── */}
      {validDebts.length > 0 && (
        <div className="card rc-card">
          <h2>Extra Payment Impact</h2>
          <p className="bp-subtitle">How adding more per month changes your outcome (using {d.strategy} strategy).</p>
          <div className="dp-impact-grid">
            {[0, 100, 200, 300, 500, 750, 1000].map(extra => {
              const res = simulate(validDebts, extra, d.strategy === 'custom' ? 'avalanche' : d.strategy, d.customOrder)
              const base = simulate(validDebts, 0, d.strategy === 'custom' ? 'avalanche' : d.strategy, d.customOrder)
              const isActive = extra === d.extraPayment
              const interestSaved = base ? base.totalInterest - res.totalInterest : 0
              const monthsSaved   = base ? base.months - res.months : 0
              return (
                <div key={extra}
                  className={`dp-impact-col ${isActive ? 'dp-impact-active' : ''}`}
                  onClick={() => set('extraPayment', extra)}
                  style={{ cursor: 'pointer' }}>
                  <div className="dp-impact-extra">
                    {extra === 0 ? 'Min Only' : `+${fmt(extra)}/mo`}
                  </div>
                  <div className="dp-impact-months">
                    {Math.floor(res.months / 12)}y {res.months % 12}m
                  </div>
                  <div className="dp-impact-interest" style={{ color: '#dc2626' }}>
                    {fmt(res.totalInterest)}
                  </div>
                  {interestSaved > 0 && (
                    <div className="dp-impact-saved" style={{ color: '#059669' }}>
                      save {fmt(interestSaved)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="bp-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>Click a column to apply that extra payment amount.</p>
        </div>
      )}

    </div>
  )
}
