import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'

const RETIRE_KEY = 'sage_retirement'
const NW_KEY     = 'finance_networth'
const BUDGET_KEY = 'finance_budget'

const DEFAULTS = {
  p1Age:              35,
  p2Age:              33,
  retireAge:          65,
  lifeExpectancy:     90,
  autoSync:           true,
  currentSavings:     57000,
  monthlyContrib:     700,
  preReturnRate:      7,
  postReturnRate:     5,
  safeWithdrawalRate: 4,
  annualSpending:     72000,
  p1SS:               1800,
  p2SS:               1200,
  pensionMonthly:     0,
  otherMonthly:       0,
}

function load() {
  try {
    const s = localStorage.getItem(RETIRE_KEY)
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS
  } catch { return DEFAULTS }
}

// Pull retirement balances + contributions from Net Worth
function syncFromNetWorth() {
  try {
    const s = localStorage.getItem(NW_KEY)
    if (!s) return null
    const accounts = JSON.parse(s)
    const ret = accounts.filter(a => a.category === 'Retirement')
    return {
      balance: ret.reduce((sum, a) => sum + (a.balance || 0), 0),
      contrib: ret.reduce((sum, a) => sum + (a.monthlyContribution || 0), 0),
    }
  } catch { return null }
}

// Pull retirement contributions from Budget Planner
function syncBudgetContrib() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    if (!s) return 0
    const b = JSON.parse(s)
    const e1 = b.earner1 || b.income || {}
    const e2 = b.earner2 || {}
    return (e1.retirement401k || e1.retirementSavings || 0) + (e2.retirement401k || e2.retirementSavings || 0)
  } catch { return 0 }
}

// Future value: balance compounded monthly with contributions
function fvMonthly(balance, annualRate, monthlyContrib, years) {
  const r = annualRate / 100 / 12
  const n = years * 12
  if (Math.abs(r) < 1e-9) return balance + monthlyContrib * n
  return balance * Math.pow(1 + r, n) +
    monthlyContrib * ((Math.pow(1 + r, n) - 1) / r)
}

// How many years until portfolio >= target (iterative, returns null if never)
function yearsToTarget(balance, monthlyContrib, annualRate, target) {
  if (balance >= target) return 0
  for (let y = 1; y <= 80; y++) {
    if (fvMonthly(balance, annualRate, monthlyContrib, y) >= target) return y
  }
  return null
}

// Build year-by-year growth + drawdown projection
function buildProjection({ currentSavings, monthlyContrib, preRate, postRate,
  yearsToRetire, lifeExpectancy, currentAge, annualWithdrawal }) {
  const data = []
  let portfolio = currentSavings
  const r = preRate / 100 / 12

  // Accumulation
  for (let y = 0; y <= yearsToRetire; y++) {
    data.push({ age: currentAge + y, portfolio: Math.round(portfolio), phase: 'acc' })
    if (y < yearsToRetire) {
      for (let m = 0; m < 12; m++) portfolio = portfolio * (1 + r) + monthlyContrib
    }
  }

  // Drawdown
  const postR = postRate / 100
  for (let y = 1; y <= lifeExpectancy - (currentAge + yearsToRetire) + 5; y++) {
    portfolio = Math.max(0, portfolio * (1 + postR) - annualWithdrawal)
    data.push({ age: currentAge + yearsToRetire + y, portfolio: Math.round(portfolio), phase: 'draw' })
    if (portfolio === 0) break
  }
  return data
}

function fmt(n) {
  return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtShort(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `$${(abs / 1_000).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

function NumInput({ label, value, onChange, prefix = '$', suffix = '', min = 0, step = 1, hint }) {
  return (
    <div className="rc-field">
      <label className="rc-label">{label}</label>
      {hint && <span className="rc-hint">{hint}</span>}
      <div className="nw-num-wrap">
        {prefix && <span className="nw-prefix">{prefix}</span>}
        <input className="nw-num-input rc-input" type="number" min={min} step={step}
          style={{ width: 90 }}
          value={value || ''} placeholder="0"
          onChange={e => onChange(parseFloat(e.target.value) || 0)} />
        {suffix && <span className="nw-suffix">{suffix}</span>}
      </div>
    </div>
  )
}

export default function RetirementCalc({ household, earnerView }) {
  const [d, setD] = useState(load)

  useEffect(() => { localStorage.setItem(RETIRE_KEY, JSON.stringify(d)) }, [d])

  const p1 = household?.p1 || 'Person 1'
  const p2 = household?.p2 || 'Person 2'
  const showBoth = earnerView === 'combined' || !earnerView
  const refAge = earnerView === 'p2' ? d.p2Age : d.p1Age

  // Auto-sync from Net Worth
  const nwSync = useMemo(() => syncFromNetWorth(), [])
  const budgetContrib = useMemo(() => syncBudgetContrib(), [])

  const savings = d.autoSync && nwSync ? nwSync.balance : d.currentSavings
  const contrib = d.autoSync && nwSync
    ? Math.max(nwSync.contrib, budgetContrib)
    : d.monthlyContrib

  // Core numbers
  const yearsToRetire = Math.max(0, d.retireAge - refAge)
  const annualSSIncome = ((showBoth ? d.p1SS + d.p2SS : earnerView === 'p1' ? d.p1SS : d.p2SS) +
    d.pensionMonthly + d.otherMonthly) * 12
  const annualWithdrawalNeeded = Math.max(0, d.annualSpending - annualSSIncome)
  const fireNumber = annualWithdrawalNeeded > 0
    ? annualWithdrawalNeeded / (d.safeWithdrawalRate / 100)
    : 0
  const projectedAtRetirement = fvMonthly(savings, d.preReturnRate, contrib, yearsToRetire)
  const progress = fireNumber > 0 ? Math.min((savings / fireNumber) * 100, 100) : 100
  const yrsToFire = yearsToTarget(savings, contrib, d.preReturnRate, fireNumber)
  const fireAge = yrsToFire != null ? refAge + yrsToFire : null

  // Health status
  const funded = fireNumber > 0 ? projectedAtRetirement / fireNumber : 1
  const health = funded >= 1.1 ? 'ahead'
    : funded >= 0.9 ? 'ontrack'
    : funded >= 0.7 ? 'behind'
    : 'critical'
  const healthMeta = {
    ahead:    { label: 'Ahead of Schedule',     color: '#059669', bg: '#ecfdf5', icon: '✓' },
    ontrack:  { label: 'On Track',              color: '#2563eb', bg: '#eff6ff', icon: '~' },
    behind:   { label: 'Needs Attention',       color: '#d97706', bg: '#fffbeb', icon: '!' },
    critical: { label: 'Significantly Off Track',color: '#dc2626', bg: '#fef2f2', icon: '✕' },
  }[health]

  // Main projection (base scenario)
  const projection = useMemo(() => buildProjection({
    currentSavings: savings,
    monthlyContrib: contrib,
    preRate: d.preReturnRate,
    postRate: d.postReturnRate,
    yearsToRetire,
    lifeExpectancy: d.lifeExpectancy,
    currentAge: refAge,
    annualWithdrawal: annualWithdrawalNeeded,
  }), [savings, contrib, d.preReturnRate, d.postReturnRate, yearsToRetire,
       d.lifeExpectancy, refAge, annualWithdrawalNeeded])

  // Chart data — split accumulation / drawdown for two-color area
  const retireAge = refAge + yearsToRetire
  const chartData = projection.map(p => ({
    age: p.age,
    'Building Wealth': p.age <= retireAge ? p.portfolio : null,
    'In Retirement':   p.age >= retireAge ? p.portfolio : null,
  }))

  // Depletion age
  const depletePoint = projection.find(p => p.phase === 'draw' && p.portfolio === 0)
  const depleteAge = depletePoint?.age ?? null

  // Return-rate scenarios
  const returnScenarios = useMemo(() => [
    { label: 'Conservative', preRate: Math.max(1, d.preReturnRate - 2), postRate: Math.max(1, d.postReturnRate - 2), color: '#ef4444' },
    { label: 'Base',         preRate: d.preReturnRate,                   postRate: d.postReturnRate,                  color: '#6366f1' },
    { label: 'Optimistic',   preRate: d.preReturnRate + 2,               postRate: d.postReturnRate + 2,              color: '#10b981' },
  ].map(s => {
    const port = fvMonthly(savings, s.preRate, contrib, yearsToRetire)
    const sufficient = fireNumber > 0 ? port >= fireNumber : true
    // How long it lasts
    let portfolioLeft = port
    let lastsYears = 0
    const postR = s.postRate / 100
    for (let y = 0; y < 60; y++) {
      portfolioLeft = Math.max(0, portfolioLeft * (1 + postR) - annualWithdrawalNeeded)
      if (portfolioLeft === 0) { lastsYears = y + 1; break }
      lastsYears = y + 1
      if (portfolioLeft > 0 && y === 59) lastsYears = 60
    }
    const lastsUntilAge = retireAge + lastsYears
    return { ...s, port, sufficient, lastsUntilAge, lastsYears }
  }), [savings, contrib, d.preReturnRate, d.postReturnRate, yearsToRetire,
       annualWithdrawalNeeded, fireNumber, retireAge])

  // Scenario chart data (all three lines, pre+post)
  const scenarioChartData = useMemo(() => {
    const datasets = returnScenarios.map(s =>
      buildProjection({
        currentSavings: savings, monthlyContrib: contrib,
        preRate: s.preRate, postRate: s.postRate,
        yearsToRetire, lifeExpectancy: d.lifeExpectancy,
        currentAge: refAge, annualWithdrawal: annualWithdrawalNeeded,
      })
    )
    const maxAge = Math.max(...datasets.flat().map(p => p.age))
    return Array.from({ length: maxAge - refAge + 1 }, (_, i) => {
      const age = refAge + i
      const row = { age }
      returnScenarios.forEach((s, si) => {
        const pt = datasets[si].find(p => p.age === age)
        row[s.label] = pt?.portfolio ?? null
      })
      return row
    })
  }, [returnScenarios, savings, contrib, yearsToRetire, d.lifeExpectancy, refAge, annualWithdrawalNeeded])

  // Retirement age scenarios
  const ageScenarios = useMemo(() => [
    { label: `Age ${d.retireAge - 5} (Early)`, yearsTo: Math.max(0, d.retireAge - 5 - refAge) },
    { label: `Age ${d.retireAge} (Target)`,    yearsTo: yearsToRetire },
    { label: `Age ${d.retireAge + 5} (Later)`, yearsTo: yearsToRetire + 5 },
  ].map(s => {
    const port = fvMonthly(savings, d.preReturnRate, contrib, s.yearsTo)
    const monthly = annualWithdrawalNeeded > 0
      ? ((port * (d.safeWithdrawalRate / 100)) / 12).toFixed(0)
      : '—'
    const pct = fireNumber > 0 ? ((port / fireNumber) * 100).toFixed(0) : '100'
    return { ...s, port, monthly, pct }
  }), [savings, contrib, d.preReturnRate, d.retireAge, refAge, yearsToRetire,
       annualWithdrawalNeeded, d.safeWithdrawalRate, fireNumber])

  function set(field, val) { setD(prev => ({ ...prev, [field]: val })) }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="cf-tooltip">
        <strong>Age {label}</strong>
        {payload.filter(p => p.value != null).map(p => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {fmtShort(p.value)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="rc-page">

      {/* ── Health Check Banner ── */}
      <div className="rc-health-banner" style={{ background: healthMeta.bg, borderColor: healthMeta.color }}>
        <div className="rc-health-icon" style={{ background: healthMeta.color }}>{healthMeta.icon}</div>
        <div className="rc-health-body">
          <span className="rc-health-label" style={{ color: healthMeta.color }}>{healthMeta.label}</span>
          <span className="rc-health-sub">
            Projected {fmtShort(projectedAtRetirement)} at age {retireAge} vs. FIRE goal of {fmtShort(fireNumber)}
            {' · '}{(funded * 100).toFixed(0)}% funded
          </span>
        </div>
        <div className="rc-health-pct" style={{ color: healthMeta.color }}>{(funded * 100).toFixed(0)}%</div>
      </div>

      <div className="rc-grid-top">

        {/* ── Profile ── */}
        <div className="card rc-card">
          <h2>Profile</h2>
          <div className="rc-fields">
            {(showBoth || earnerView === 'p1') && (
              <NumInput label={`${p1}'s Current Age`} value={d.p1Age} step={1} prefix=""
                onChange={v => set('p1Age', v)} />
            )}
            {(showBoth || earnerView === 'p2') && (
              <NumInput label={`${p2}'s Current Age`} value={d.p2Age} step={1} prefix=""
                onChange={v => set('p2Age', v)} />
            )}
            <NumInput label="Target Retirement Age" value={d.retireAge} step={1} prefix=""
              onChange={v => set('retireAge', v)} />
            <NumInput label="Life Expectancy" value={d.lifeExpectancy} step={1} prefix=""
              hint="Used for drawdown planning"
              onChange={v => set('lifeExpectancy', v)} />
          </div>
          <div className="rc-derived-row">
            <span>Years to retirement</span>
            <strong>{yearsToRetire} yrs</strong>
          </div>
        </div>

        {/* ── Savings & Returns ── */}
        <div className="card rc-card">
          <div className="rc-card-head">
            <h2>Savings &amp; Returns</h2>
            {nwSync && (
              <label className="rc-sync-toggle">
                <input type="checkbox" checked={d.autoSync}
                  onChange={e => set('autoSync', e.target.checked)} />
                Auto-sync from Net Worth
              </label>
            )}
          </div>
          {d.autoSync && nwSync && (
            <p className="bp-subtitle" style={{ marginBottom: 10 }}>
              Synced: <strong>{fmt(nwSync.balance)}</strong> balance · <strong>{fmt(nwSync.contrib)}/mo</strong> contributions
            </p>
          )}
          <div className="rc-fields">
            {!d.autoSync && (
              <>
                <NumInput label="Current Retirement Savings" value={d.currentSavings} step={1000}
                  onChange={v => set('currentSavings', v)} />
                <NumInput label="Monthly Contribution" value={d.monthlyContrib} step={50}
                  onChange={v => set('monthlyContrib', v)} />
              </>
            )}
            <NumInput label="Pre-Retirement Return" value={d.preReturnRate} step={0.5} prefix="" suffix="%"
              hint="Avg annual return while investing"
              onChange={v => set('preReturnRate', v)} />
            <NumInput label="Post-Retirement Return" value={d.postReturnRate} step={0.5} prefix="" suffix="%"
              hint="Avg annual return in retirement"
              onChange={v => set('postReturnRate', v)} />
            <NumInput label="Safe Withdrawal Rate" value={d.safeWithdrawalRate} step={0.25} prefix="" suffix="%"
              hint="4% rule is common starting point"
              onChange={v => set('safeWithdrawalRate', v)} />
          </div>
        </div>

        {/* ── Income Needs ── */}
        <div className="card rc-card">
          <h2>Retirement Income</h2>
          <div className="rc-fields">
            <NumInput label="Annual Spending Goal" value={d.annualSpending} step={1000}
              hint="Target spending in today's dollars"
              onChange={v => set('annualSpending', v)} />
            {(showBoth || earnerView === 'p1') && (
              <NumInput label={`${p1} Social Security`} value={d.p1SS} step={50}
                hint="Estimated monthly benefit"
                onChange={v => set('p1SS', v)} />
            )}
            {(showBoth || earnerView === 'p2') && (
              <NumInput label={`${p2} Social Security`} value={d.p2SS} step={50}
                hint="Estimated monthly benefit"
                onChange={v => set('p2SS', v)} />
            )}
            <NumInput label="Pension" value={d.pensionMonthly} step={50}
              hint="Monthly pension income"
              onChange={v => set('pensionMonthly', v)} />
            <NumInput label="Other Income" value={d.otherMonthly} step={50}
              hint="Part-time work, rental, etc."
              onChange={v => set('otherMonthly', v)} />
          </div>
          <div className="rc-derived-row">
            <span>Annual income from sources</span>
            <strong className="rc-green">{fmt(annualSSIncome)}</strong>
          </div>
          <div className="rc-derived-row">
            <span>Portfolio must cover</span>
            <strong>{fmt(annualWithdrawalNeeded)}/yr</strong>
          </div>
        </div>

      </div>{/* end rc-grid-top */}

      {/* ── FIRE Number ── */}
      <div className="card rc-card rc-fire-card">
        <div className="rc-fire-left">
          <p className="rc-fire-eyebrow">Your FIRE Number</p>
          <p className="rc-fire-num">{fmtShort(fireNumber)}</p>
          <p className="rc-fire-sub">
            {annualWithdrawalNeeded > 0
              ? `${fmt(annualWithdrawalNeeded)}/yr ÷ ${d.safeWithdrawalRate}% withdrawal rate`
              : 'Income sources cover all expenses — no portfolio withdrawal needed!'}
          </p>

          <div className="rc-fire-stats">
            <div className="rc-fire-stat">
              <span>Current Savings</span>
              <strong>{fmtShort(savings)}</strong>
            </div>
            <div className="rc-fire-stat">
              <span>Projected at {retireAge}</span>
              <strong className={projectedAtRetirement >= fireNumber ? 'rc-green' : 'rc-red'}>
                {fmtShort(projectedAtRetirement)}
              </strong>
            </div>
            <div className="rc-fire-stat">
              <span>FIRE Age</span>
              <strong>{fireAge != null ? `${fireAge} (${yrsToFire} yrs)` : 'Not in range'}</strong>
            </div>
          </div>
        </div>

        <div className="rc-fire-right">
          <div className="rc-progress-label">
            <span>Progress to FIRE</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="rc-progress-track">
            <div className="rc-progress-fill" style={{ width: `${progress}%` }} />
            {projectedAtRetirement > savings && (
              <div className="rc-progress-proj"
                style={{ width: `${Math.min((projectedAtRetirement / fireNumber) * 100, 100)}%` }} />
            )}
          </div>
          <div className="rc-progress-legend">
            <span><span className="rc-dot rc-dot-fill"/>Current {fmtShort(savings)}</span>
            <span><span className="rc-dot rc-dot-proj"/>At {retireAge} {fmtShort(projectedAtRetirement)}</span>
            <span><span className="rc-dot rc-dot-goal"/>Goal {fmtShort(fireNumber)}</span>
          </div>

          {depleteAge && depleteAge <= d.lifeExpectancy && (
            <div className="rc-deplete-warn">
              ⚠ At base assumptions, portfolio depletes at age {depleteAge}
            </div>
          )}
          {(!depleteAge || depleteAge > d.lifeExpectancy) && annualWithdrawalNeeded > 0 && (
            <div className="rc-deplete-ok">
              Portfolio sustains withdrawals through age {d.lifeExpectancy}+
            </div>
          )}
        </div>
      </div>

      {/* ── Projection Chart ── */}
      <div className="card rc-card">
        <h2>Portfolio Projection</h2>
        <p className="bp-subtitle">
          Accumulation to age {retireAge}, then drawdown · {d.preReturnRate}% pre / {d.postReturnRate}% post retirement return
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="drawGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="age" tickFormatter={v => `${v}`} tick={{ fontSize: 11 }}
              label={{ value: 'Age', position: 'insideBottom', offset: -2, fontSize: 11 }} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="top" />
            <ReferenceLine x={retireAge} stroke="#6366f1" strokeDasharray="5 3"
              label={{ value: `Retire ${retireAge}`, position: 'top', fill: '#6366f1', fontSize: 11 }} />
            {fireNumber > 0 && (
              <ReferenceLine y={fireNumber} stroke="#10b981" strokeDasharray="4 2"
                label={{ value: 'FIRE', position: 'right', fill: '#10b981', fontSize: 11 }} />
            )}
            <Area type="monotone" dataKey="Building Wealth" stroke="#6366f1" strokeWidth={2}
              fill="url(#accGrad)" connectNulls={false} dot={false} />
            <Area type="monotone" dataKey="In Retirement" stroke="#f59e0b" strokeWidth={2}
              fill="url(#drawGrad)" connectNulls={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Scenario Analysis ── */}
      <div className="card rc-card">
        <h2>Scenario Analysis</h2>
        <div className="rc-scenario-grid">

          {/* Return rate scenarios */}
          <div>
            <h3 className="rc-scenario-subtitle">Return Rate Scenarios</h3>
            <table className="amort-table rc-scenario-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Scenario</th>
                  <th>Portfolio at {retireAge}</th>
                  <th>vs. Goal</th>
                  <th>Lasts Until</th>
                </tr>
              </thead>
              <tbody>
                {returnScenarios.map(s => (
                  <tr key={s.label}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="rc-scenario-dot" style={{ background: s.color }} />
                      {s.label}
                    </td>
                    <td style={{ color: s.sufficient ? '#059669' : '#dc2626', fontWeight: 600 }}>
                      {fmtShort(s.port)}
                    </td>
                    <td style={{ color: s.sufficient ? '#059669' : '#dc2626' }}>
                      {fireNumber > 0 ? `${((s.port / fireNumber) * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td>{s.lastsYears >= 60 ? `${retireAge + 60}+` : `Age ${s.lastsUntilAge}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16 }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={scenarioChartData} margin={{ top: 5, right: 12, left: 8, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="age" tick={{ fontSize: 11 }}
                    label={{ value: 'Age', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine x={retireAge} stroke="#94a3b8" strokeDasharray="4 3" />
                  {returnScenarios.map(s => (
                    <Line key={s.label} type="monotone" dataKey={s.label}
                      stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Retirement age scenarios */}
          <div>
            <h3 className="rc-scenario-subtitle">Retirement Age Scenarios</h3>
            <table className="amort-table rc-scenario-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Retire At</th>
                  <th>Portfolio</th>
                  <th>Safe/mo</th>
                  <th>% of Goal</th>
                </tr>
              </thead>
              <tbody>
                {ageScenarios.map((s, i) => (
                  <tr key={s.label} style={{ fontWeight: i === 1 ? 700 : 'normal' }}>
                    <td style={{ textAlign: 'left' }}>{s.label}</td>
                    <td style={{ color: parseFloat(s.pct) >= 100 ? '#059669' : '#dc2626', fontWeight: 600 }}>
                      {fmtShort(s.port)}
                    </td>
                    <td>{s.monthly !== '—' ? `$${parseInt(s.monthly).toLocaleString()}/mo` : '—'}</td>
                    <td style={{ color: parseFloat(s.pct) >= 100 ? '#059669' : '#dc2626' }}>{s.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rc-age-callouts">
              {ageScenarios.map((s, i) => (
                <div key={s.label} className={`rc-age-callout ${i === 1 ? 'rc-age-target' : ''}`}>
                  <span className="rc-age-callout-label">{s.label}</span>
                  <span className="rc-age-callout-val">{fmtShort(s.port)}</span>
                  <div className="rc-mini-bar">
                    <div className="rc-mini-fill"
                      style={{ width: `${Math.min(parseFloat(s.pct), 100)}%`,
                               background: parseFloat(s.pct) >= 100 ? '#059669' : '#f59e0b' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

    </div>
  )
}
