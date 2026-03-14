import { setAppData } from '../lib/db'
import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts'

const INV_KEY = 'sage_investments'

// ── Asset class definitions ────────────────────────────────────
const ASSET_CLASSES = [
  { key: 'usLargeCap',  label: 'US Large Cap',            color: '#6366f1' },
  { key: 'usSmallMid',  label: 'US Small / Mid Cap',      color: '#8b5cf6' },
  { key: 'intlDev',     label: 'Intl Developed',          color: '#3b82f6' },
  { key: 'emerging',    label: 'Emerging Markets',        color: '#06b6d4' },
  { key: 'usBonds',     label: 'US Bonds',                color: '#10b981' },
  { key: 'intlBonds',   label: 'Intl Bonds / TIPS',       color: '#34d399' },
  { key: 'realEstate',  label: 'Real Estate / REITs',     color: '#f59e0b' },
  { key: 'commodities', label: 'Commodities / Gold',      color: '#f97316' },
  { key: 'cash',        label: 'Cash / Money Market',     color: '#94a3b8' },
]
const AC_MAP = Object.fromEntries(ASSET_CLASSES.map(a => [a.key, a]))

// ── Preset allocations ─────────────────────────────────────────
const PRESETS = [
  {
    key: 'conservative',
    label: 'Conservative',
    icon: '🛡️',
    desc: 'Capital preservation with modest growth',
    target: { usBonds: 40, intlBonds: 15, usLargeCap: 20, intlDev: 10, cash: 15 },
  },
  {
    key: 'balanced',
    label: 'Balanced 60/40',
    icon: '⚖️',
    desc: 'Classic balanced portfolio',
    target: { usLargeCap: 40, intlDev: 18, usSmallMid: 7, usBonds: 25, intlBonds: 5, cash: 5 },
  },
  {
    key: 'growth',
    label: 'Growth 80/20',
    icon: '📈',
    desc: 'Equity-heavy for long-term investors',
    target: { usLargeCap: 45, usSmallMid: 10, intlDev: 20, emerging: 5, usBonds: 15, cash: 5 },
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    icon: '🚀',
    desc: '100% equities, maximum long-term growth',
    target: { usLargeCap: 50, usSmallMid: 15, intlDev: 25, emerging: 10 },
  },
  {
    key: 'threeFund',
    label: 'Three-Fund',
    icon: '🔺',
    desc: 'Total US / Total Intl / Total Bond',
    target: { usLargeCap: 60, intlDev: 30, usBonds: 10 },
  },
]

const DEFAULT_HOLDINGS = [
  { id: 'h1', name: 'S&P 500 Index (FXAIX)',     assetClass: 'usLargeCap', value: 45_000, account: '401k'    },
  { id: 'h2', name: 'Total Intl Index (FTIAX)',   assetClass: 'intlDev',    value: 18_000, account: '401k'    },
  { id: 'h3', name: 'Total Bond Index (FTBFX)',   assetClass: 'usBonds',    value: 12_000, account: '401k'    },
  { id: 'h4', name: 'Small Cap Index (FSSNX)',    assetClass: 'usSmallMid', value: 8_000,  account: 'ira'     },
  { id: 'h5', name: 'REIT Index (FSRNX)',         assetClass: 'realEstate', value: 5_000,  account: 'ira'     },
  { id: 'h6', name: 'HYSA / Cash',                assetClass: 'cash',       value: 10_000, account: 'taxable' },
]

const DEFAULT_TARGET = { usLargeCap: 45, usSmallMid: 10, intlDev: 20, emerging: 5, usBonds: 15, cash: 5 }

const DEFAULTS = {
  holdings:           DEFAULT_HOLDINGS,
  target:             DEFAULT_TARGET,
  activePreset:       'growth',
  newContribution:    1_000,
  driftThreshold:     5,   // % drift before flagging
}

function load() {
  try {
    const s = localStorage.getItem(INV_KEY)
    if (s) return { ...DEFAULTS, ...JSON.parse(s) }
    return DEFAULTS
  } catch { return DEFAULTS }
}

function fmt(n)  { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` }

function sumTarget(t) { return Object.values(t).reduce((s, v) => s + (v || 0), 0) }

// ── NumInput ──────────────────────────────────────────────────
function NumInput({ value, onChange, prefix = '$', suffix = '', step = 100, min = 0, width = 88 }) {
  return (
    <div className="nw-num-wrap" style={{ width: 'fit-content' }}>
      {prefix && <span className="nw-prefix">{prefix}</span>}
      <input className="nw-num-input" type="number" min={min} step={step}
        value={value || ''} placeholder="0"
        style={{ width }}
        onChange={e => onChange(parseFloat(e.target.value) || 0)} />
      {suffix && <span className="nw-suffix">{suffix}</span>}
    </div>
  )
}

export default function InvestmentAllocation() {
  const [d, setD] = useState(load)

  useEffect(() => {
    localStorage.setItem(INV_KEY, JSON.stringify(d))
    setAppData('investments', d).catch(console.error)
  }, [d])

  function set(field, val) { setD(prev => ({ ...prev, [field]: val })) }

  // ── Calculations ──────────────────────────────────────────
  const calc = useMemo(() => {
    const total = d.holdings.reduce((s, h) => s + (h.value || 0), 0)

    // Current allocation by asset class
    const current = {}
    ASSET_CLASSES.forEach(({ key }) => { current[key] = 0 })
    d.holdings.forEach(h => {
      if (h.assetClass && current[h.assetClass] !== undefined)
        current[h.assetClass] += (h.value || 0)
    })

    const targetSum = sumTarget(d.target)

    // Per-class analysis
    const rows = ASSET_CLASSES.map(ac => {
      const curVal  = current[ac.key] || 0
      const curPct  = total > 0 ? (curVal / total) * 100 : 0
      const tgtPct  = targetSum > 0 ? ((d.target[ac.key] || 0) / targetSum) * 100 : 0
      const drift   = curPct - tgtPct
      const tgtVal  = total * (tgtPct / 100)
      const action  = Math.abs(drift) < 0.5 ? 'hold'
                    : drift > 0 ? 'sell' : 'buy'
      const delta   = tgtVal - curVal  // positive = buy, negative = sell
      return { ...ac, curVal, curPct, tgtPct, drift, tgtVal, delta, action }
    }).filter(r => r.curVal > 0 || r.tgtPct > 0)

    // New contribution allocation
    const contrib = d.newContribution || 0
    const contribAlloc = rows
      .filter(r => r.tgtPct > 0)
      .map(r => ({
        ...r,
        contribAmt: Math.round(contrib * (r.tgtPct / 100)),
      }))
      .sort((a, b) => b.contribAmt - a.contribAmt)

    // Drift score: avg absolute drift weighted by target size
    const driftScore = rows.reduce((s, r) => s + Math.abs(r.drift), 0) / Math.max(rows.length, 1)
    const needsRebalance = rows.some(r => Math.abs(r.drift) >= d.driftThreshold)

    // Chart data for comparison
    const barData = rows.map(r => ({
      name:    r.label.replace('/', '/\n'),
      current: parseFloat(r.curPct.toFixed(1)),
      target:  parseFloat(r.tgtPct.toFixed(1)),
      color:   r.color,
    }))

    // Pie data
    const pieCurrent = rows.filter(r => r.curVal > 0).map(r => ({ name: r.label, value: Math.round(r.curVal), color: r.color }))
    const pieTarget  = rows.filter(r => r.tgtPct > 0).map(r => ({ name: r.label, value: parseFloat(r.tgtPct.toFixed(1)), color: r.color }))

    return { total, current, rows, contribAlloc, driftScore, needsRebalance, barData, pieCurrent, pieTarget, targetSum }
  }, [d])

  // ── Holdings CRUD ─────────────────────────────────────────
  function addHolding() {
    setD(prev => ({
      ...prev,
      holdings: [...prev.holdings, { id: crypto.randomUUID(), name: '', assetClass: 'usLargeCap', value: 0, account: '401k' }],
    }))
  }
  function updateHolding(id, field, val) {
    setD(prev => ({ ...prev, holdings: prev.holdings.map(h => h.id === id ? { ...h, [field]: val } : h) }))
  }
  function deleteHolding(id) {
    setD(prev => ({ ...prev, holdings: prev.holdings.filter(h => h.id !== id) }))
  }

  // ── Target allocation editing ─────────────────────────────
  function setTarget(key, val) {
    setD(prev => ({ ...prev, target: { ...prev.target, [key]: val }, activePreset: null }))
  }
  function applyPreset(preset) {
    setD(prev => ({ ...prev, target: { ...preset.target }, activePreset: preset.key }))
  }

  const targetSum = sumTarget(d.target)
  const targetOk  = Math.abs(targetSum - 100) <= 1

  return (
    <div className="inv-page">

      {/* ── Rebalance Status Banner ── */}
      {calc.total > 0 && (
        <div className={`inv-banner ${calc.needsRebalance ? 'inv-banner-warn' : 'inv-banner-ok'}`}>
          <div className={`inv-banner-icon ${calc.needsRebalance ? '' : 'inv-banner-icon-ok'}`}>
            {calc.needsRebalance ? '⚠' : '✓'}
          </div>
          <div className="ef-banner-body">
            <span className="ef-banner-label">
              {calc.needsRebalance ? 'Rebalancing Recommended' : 'Portfolio Aligned'}
            </span>
            <span className="ef-banner-sub">
              {calc.needsRebalance
                ? `One or more asset classes have drifted more than ${d.driftThreshold}% from target. See rebalancing actions below.`
                : `All asset classes are within ${d.driftThreshold}% of their targets. Portfolio looks healthy.`}
            </span>
          </div>
          <div className="inv-banner-val">
            {fmt(calc.total)}
            <span>total portfolio</span>
          </div>
        </div>
      )}

      {/* ── Top: Holdings + Target ── */}
      <div className="inv-top-grid">

        {/* Current Holdings */}
        <div className="card rc-card">
          <div className="rc-card-head" style={{ marginBottom: 12 }}>
            <h2>Current Holdings</h2>
            <button className="ef-log-btn" onClick={addHolding}>+ Add</button>
          </div>
          <div className="inv-holdings-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Name / Ticker</th>
                  <th>Asset Class</th>
                  <th>Account</th>
                  <th>Value</th>
                  <th>%</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.holdings.map(h => {
                  const pct = calc.total > 0 ? ((h.value || 0) / calc.total * 100).toFixed(1) : '0.0'
                  const ac  = AC_MAP[h.assetClass]
                  return (
                    <tr key={h.id}>
                      <td>
                        <input className="nw-text-input" value={h.name} placeholder="e.g. FXAIX"
                          onChange={e => updateHolding(h.id, 'name', e.target.value)} />
                      </td>
                      <td>
                        <select className="nw-select" value={h.assetClass}
                          onChange={e => updateHolding(h.id, 'assetClass', e.target.value)}>
                          {ASSET_CLASSES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="nw-select" value={h.account}
                          onChange={e => updateHolding(h.id, 'account', e.target.value)}>
                          <option value="401k">401(k)</option>
                          <option value="ira">IRA / Roth</option>
                          <option value="taxable">Taxable</option>
                          <option value="hsa">HSA</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td>
                        <NumInput value={h.value} step={500} onChange={v => updateHolding(h.id, 'value', v)} />
                      </td>
                      <td className="inv-pct-cell">
                        <span className="inv-ac-dot" style={{ background: ac?.color }} />
                        {pct}%
                      </td>
                      <td>
                        <button className="nw-delete" onClick={() => deleteHolding(h.id)}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="inv-total-row">
                  <td colSpan={3}>Total Portfolio</td>
                  <td><strong>{fmt(calc.total)}</strong></td>
                  <td>100%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Target Allocation */}
        <div className="card rc-card">
          <h2>Target Allocation</h2>

          {/* Presets */}
          <div className="inv-presets">
            {PRESETS.map(p => (
              <button key={p.key}
                className={`inv-preset-btn ${d.activePreset === p.key ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
                title={p.desc}>
                <span>{p.icon}</span> {p.label}
              </button>
            ))}
          </div>

          {/* Target inputs */}
          <div className="inv-target-grid">
            {ASSET_CLASSES.map(ac => (
              <div key={ac.key} className="inv-target-row">
                <span className="inv-ac-dot" style={{ background: ac.color }} />
                <span className="inv-target-label">{ac.label}</span>
                <div className="nw-num-wrap" style={{ width: 'fit-content', marginLeft: 'auto' }}>
                  <input className="nw-num-input" type="number" min={0} max={100} step={1}
                    value={d.target[ac.key] || ''} placeholder="0"
                    style={{ width: 48 }}
                    onChange={e => setTarget(ac.key, parseFloat(e.target.value) || 0)} />
                  <span className="nw-suffix">%</span>
                </div>
              </div>
            ))}
          </div>

          <div className={`inv-target-sum ${targetOk ? 'inv-sum-ok' : 'inv-sum-warn'}`}>
            Total: {targetSum.toFixed(0)}%
            {!targetOk && ` — must equal 100% (${targetSum > 100 ? 'over' : 'under'} by ${Math.abs(targetSum - 100).toFixed(0)}%)`}
          </div>
        </div>

      </div>

      {/* ── Allocation Comparison Chart ── */}
      {calc.total > 0 && (
        <div className="card rc-card">
          <h2>Current vs. Target Allocation</h2>
          <p className="bp-subtitle">Bars show your current allocation (solid) vs target (outlined). Gap highlights where to rebalance.</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={calc.barData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 130 }}
              barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text)' }} width={130} />
              <Tooltip formatter={(v, name) => [`${v}%`, name === 'current' ? 'Current' : 'Target']} />
              <Bar dataKey="current" name="current" radius={[0, 3, 3, 0]} maxBarSize={14}>
                {calc.barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
              <Bar dataKey="target" name="target" radius={[0, 3, 3, 0]} maxBarSize={14}
                fill="transparent">
                {calc.barData.map((entry, i) => <Cell key={i} fill={`${entry.color}55`} stroke={entry.color} strokeWidth={1.5} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="inv-chart-legend">
            <span><span className="inv-legend-swatch" style={{ background: '#6366f1' }} />Current allocation</span>
            <span><span className="inv-legend-swatch" style={{ background: '#6366f155', border: '1.5px solid #6366f1' }} />Target allocation</span>
          </div>
        </div>
      )}

      {/* ── Drift & Rebalancing Table ── */}
      {calc.total > 0 && (
        <div className="card rc-card">
          <h2>Drift Analysis &amp; Rebalancing</h2>
          <p className="bp-subtitle">
            Drift threshold: {d.driftThreshold}%
            &nbsp;·&nbsp;
            <button className="link-btn" onClick={() => set('driftThreshold', d.driftThreshold === 5 ? 3 : d.driftThreshold === 3 ? 1 : 5)}>
              Change ({d.driftThreshold === 5 ? 'strict: 3%' : d.driftThreshold === 3 ? 'very strict: 1%' : 'standard: 5%'})
            </button>
          </p>
          <div className="inv-drift-scroll">
            <table className="inv-drift-table">
              <thead>
                <tr>
                  <th>Asset Class</th>
                  <th>Current Value</th>
                  <th>Current %</th>
                  <th>Target %</th>
                  <th>Drift</th>
                  <th>Action</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map(r => {
                  const overThreshold = Math.abs(r.drift) >= d.driftThreshold
                  return (
                    <tr key={r.key} className={overThreshold ? 'inv-row-flag' : ''}>
                      <td>
                        <span className="inv-ac-dot" style={{ background: r.color }} />
                        {r.label}
                      </td>
                      <td>{fmt(r.curVal)}</td>
                      <td>{r.curPct.toFixed(1)}%</td>
                      <td>{r.tgtPct.toFixed(1)}%</td>
                      <td>
                        <span className={`inv-drift-badge ${r.drift > d.driftThreshold ? 'inv-drift-over' : r.drift < -d.driftThreshold ? 'inv-drift-under' : 'inv-drift-ok'}`}>
                          {fmtPct(r.drift)}
                        </span>
                      </td>
                      <td>
                        {r.action === 'buy'  && <span className="inv-action inv-action-buy">BUY</span>}
                        {r.action === 'sell' && <span className="inv-action inv-action-sell">SELL</span>}
                        {r.action === 'hold' && <span className="inv-action inv-action-hold">HOLD</span>}
                      </td>
                      <td style={{ fontWeight: r.action !== 'hold' ? 600 : 400, color: r.action === 'buy' ? '#059669' : r.action === 'sell' ? '#dc2626' : 'var(--text-muted)' }}>
                        {r.action !== 'hold' ? fmt(Math.abs(r.delta)) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="bp-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
            Note: Rebalancing amounts assume selling overweight assets and buying underweight. Consider tax implications in taxable accounts — rebalancing via new contributions is often more tax-efficient.
          </p>
        </div>
      )}

      {/* ── New Contribution Allocator ── */}
      {calc.total > 0 && (
        <div className="card rc-card">
          <div className="rc-card-head" style={{ marginBottom: 12 }}>
            <h2>New Contribution Allocator</h2>
          </div>
          <p className="bp-subtitle">Where to direct your next contribution to move toward your target allocation.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <label className="rc-label" style={{ whiteSpace: 'nowrap' }}>Amount to invest</label>
            <NumInput value={d.newContribution} step={100} wide onChange={v => set('newContribution', v)} />
          </div>
          <div className="inv-contrib-grid">
            {calc.contribAlloc.filter(r => r.contribAmt > 0).map(r => (
              <div key={r.key} className="inv-contrib-card">
                <div className="inv-contrib-bar" style={{ background: `${r.color}22`, border: `1px solid ${r.color}55` }}>
                  <div className="inv-contrib-fill" style={{ width: `${r.tgtPct}%`, background: r.color }} />
                </div>
                <span className="inv-ac-dot" style={{ background: r.color }} />
                <span className="inv-contrib-label">{r.label}</span>
                <span className="inv-contrib-pct" style={{ color: r.color }}>{r.tgtPct.toFixed(0)}%</span>
                <span className="inv-contrib-amt">{fmt(r.contribAmt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pie Charts ── */}
      {calc.total > 0 && (
        <div className="inv-pie-grid">

          <div className="card rc-card">
            <h2>Current Allocation</h2>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={calc.pieCurrent} cx="50%" cy="50%" outerRadius={85} dataKey="value" labelLine={false}
                  label={({ percent }) => percent > 0.06 ? `${(percent * 100).toFixed(0)}%` : ''}>
                  {calc.pieCurrent.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v) => [fmt(v), '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="inv-pie-legend">
              {calc.pieCurrent.map(e => (
                <div key={e.name} className="tax-pie-item">
                  <span className="rc-dot" style={{ background: e.color, borderRadius: 3 }} />
                  <span>{e.name}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt(e.value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card rc-card">
            <h2>Target Allocation</h2>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={calc.pieTarget} cx="50%" cy="50%" outerRadius={85} dataKey="value" labelLine={false}
                  label={({ percent }) => percent > 0.06 ? `${(percent * 100).toFixed(0)}%` : ''}>
                  {calc.pieTarget.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v, name) => [`${v}%`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="inv-pie-legend">
              {calc.pieTarget.map(e => (
                <div key={e.name} className="tax-pie-item">
                  <span className="rc-dot" style={{ background: e.color, borderRadius: 3 }} />
                  <span>{e.name}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{e.value}%</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

    </div>
  )
}
