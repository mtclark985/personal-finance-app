import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const NW_KEY    = 'finance_networth'
const LOANS_KEY = 'finance_loans'

const CATEGORIES = ['Retirement', 'Savings', 'Investments', 'Real Estate', 'Vehicles', 'Other']
const CATEGORY_COLORS = {
  Retirement:   '#6366f1',
  Savings:      '#10b981',
  Investments:  '#f59e0b',
  'Real Estate':'#3b82f6',
  Vehicles:     '#8b5cf6',
  Other:        '#64748b',
}

const DEFAULT_ACCOUNTS = [
  { id: 'a1', name: '401(k)',              category: 'Retirement',   balance: 45000, growthRate: 7.0, monthlyContribution: 500 },
  { id: 'a2', name: 'Roth IRA',            category: 'Retirement',   balance: 12000, growthRate: 7.0, monthlyContribution: 200 },
  { id: 'a3', name: 'High-Yield Savings',  category: 'Savings',      balance: 8000,  growthRate: 4.5, monthlyContribution: 300 },
  { id: 'a4', name: 'Checking',            category: 'Savings',      balance: 3500,  growthRate: 0.1, monthlyContribution: 0   },
  { id: 'a5', name: 'Brokerage',           category: 'Investments',  balance: 15000, growthRate: 8.0, monthlyContribution: 200 },
  { id: 'a6', name: 'Primary Home',        category: 'Real Estate',  balance: 420000,growthRate: 3.5, monthlyContribution: 0   },
  { id: 'a7', name: 'Vehicle',             category: 'Vehicles',     balance: 22000, growthRate: -15, monthlyContribution: 0   },
]

function load() {
  try {
    const s = localStorage.getItem(NW_KEY)
    return s ? JSON.parse(s) : DEFAULT_ACCOUNTS
  } catch { return DEFAULT_ACCOUNTS }
}

function loadLoans() {
  try {
    const s = localStorage.getItem(LOANS_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

// Remaining loan balance after `years` of payments using the exact amortization formula
function loanBalanceAtYear(loan, years) {
  const months = Math.round(years * 12)
  if (months >= loan.termMonths) return 0
  const r = loan.annualRate / 100 / 12
  const N = loan.termMonths
  const B = loan.balance
  if (r < 1e-9) return Math.max(0, B - (B / N) * months)
  const payment = B * (r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1)
  const factor = Math.pow(1 + r, months)
  return Math.max(0, B * factor - payment * (factor - 1) / r)
}

function fv(balance, annualRate, monthlyContribution, years) {
  const r = annualRate / 100 / 12
  const n = years * 12
  if (Math.abs(r) < 1e-9) return balance + monthlyContribution * n
  return balance * Math.pow(1 + r, n) +
    monthlyContribution * ((Math.pow(1 + r, n) - 1) / r)
}

function fmt(n) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−$' : '$'
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}
function fmtFull(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const PROJ_YEARS = [1, 5, 10, 20, 30]

export default function NetWorth() {
  const [accounts, setAccounts] = useState(load)
  const [loans, setLoans]       = useState(loadLoans)

  // Re-read loans whenever this tab is focused (in case user edited them)
  useEffect(() => {
    function onFocus() { setLoans(loadLoans()) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    localStorage.setItem(NW_KEY, JSON.stringify(accounts))
    setAppData('net_worth', accounts).catch(console.error)
  }, [accounts])

  function add() {
    setAccounts(p => [...p, {
      id: crypto.randomUUID(), name: '', category: 'Savings',
      balance: 0, growthRate: 5, monthlyContribution: 0,
    }])
  }
  function upd(id, field, val) {
    setAccounts(p => p.map(a => a.id === id ? { ...a, [field]: val } : a))
  }
  function del(id) { setAccounts(p => p.filter(a => a.id !== id)) }

  const totalAssets       = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts])
  const totalLiabilities  = useMemo(() => loans.reduce((s, l) => s + (l.balance || 0), 0), [loans])
  const netWorth          = totalAssets - totalLiabilities

  const categoryTotals = useMemo(() => {
    const t = Object.fromEntries(CATEGORIES.map(c => [c, 0]))
    accounts.forEach(a => { t[a.category] = (t[a.category] || 0) + a.balance })
    return t
  }, [accounts])

  const activeCategories = CATEGORIES.filter(c => accounts.some(a => a.category === c))

  // Projection rows: one per account, columns = PROJ_YEARS
  const projRows = useMemo(() =>
    accounts.map(a => ({
      ...a,
      projections: PROJ_YEARS.map(y => fv(a.balance, a.growthRate, a.monthlyContribution, y)),
    }))
  , [accounts])

  const projTotals = useMemo(() =>
    PROJ_YEARS.map((_, yi) => projRows.reduce((s, r) => s + r.projections[yi], 0))
  , [projRows])

  // Chart data: yearly samples 0–30
  const chartData = useMemo(() => {
    const pts = []
    for (let y = 0; y <= 30; y++) {
      const pt = { year: y }
      CATEGORIES.forEach(c => {
        pt[c] = accounts.filter(a => a.category === c)
          .reduce((s, a) => s + fv(a.balance, a.growthRate, a.monthlyContribution, y), 0)
      })
      pt.Total       = accounts.reduce((s, a) => s + fv(a.balance, a.growthRate, a.monthlyContribution, y), 0)
      pt.Liabilities = loans.reduce((s, l) => s + loanBalanceAtYear(l, y), 0)
      pt['Net Worth'] = pt.Total - pt.Liabilities
      pts.push(pt)
    }
    return pts
  }, [accounts, loans])

  return (
    <div className="nw-planner">

      {/* Accounts table */}
      <div className="card nw-card">
        <h2>Accounts &amp; Assets</h2>
        <div className="nw-table-scroll">
          <table className="nw-table">
            <thead>
              <tr>
                <th>Account / Asset</th>
                <th>Category</th>
                <th>Current Value</th>
                <th>Annual Growth %</th>
                <th>Monthly Contribution</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id}>
                  <td>
                    <input className="nw-text-input" value={a.name} placeholder="Account name"
                      onChange={e => upd(a.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <select className="nw-select" value={a.category}
                      onChange={e => upd(a.id, 'category', e.target.value)}>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="nw-num-wrap">
                      <span className="nw-prefix">$</span>
                      <input className="nw-num-input" type="number" min="0" step="100"
                        value={a.balance || ''} placeholder="0"
                        onChange={e => upd(a.id, 'balance', parseFloat(e.target.value) || 0)} />
                    </div>
                  </td>
                  <td>
                    <div className="nw-num-wrap">
                      <input className="nw-num-input" type="number" step="0.1" min="-50" max="50"
                        value={a.growthRate ?? ''} placeholder="0"
                        onChange={e => upd(a.id, 'growthRate', parseFloat(e.target.value) || 0)} />
                      <span className="nw-suffix">%</span>
                    </div>
                  </td>
                  <td>
                    <div className="nw-num-wrap">
                      <span className="nw-prefix">$</span>
                      <input className="nw-num-input" type="number" min="0" step="50"
                        value={a.monthlyContribution || ''} placeholder="0"
                        onChange={e => upd(a.id, 'monthlyContribution', parseFloat(e.target.value) || 0)} />
                    </div>
                  </td>
                  <td>
                    <button className="nw-delete" onClick={() => del(a.id)} title="Remove">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="bp-add-row" style={{ marginTop: 10 }} onClick={add}>+ Add account / asset</button>

        {/* Summary bar */}
        <div className="nw-summary-strip">
          <div className="nw-total-badge">
            <span className="nw-total-label">Total Assets</span>
            <span className="nw-total-val">{fmtFull(totalAssets)}</span>
          </div>
          {totalLiabilities > 0 && (
            <div className="nw-total-badge nw-liab-badge">
              <span className="nw-total-label">Liabilities</span>
              <span className="nw-total-val nw-liab-val">−{fmtFull(totalLiabilities)}</span>
            </div>
          )}
          <div className="nw-total-badge nw-nw-badge">
            <span className="nw-total-label">Net Worth</span>
            <span className={`nw-total-val ${netWorth >= 0 ? 'nw-nw-pos' : 'nw-nw-neg'}`}>{fmtFull(netWorth)}</span>
          </div>
          <div className="nw-cat-pills">
            {activeCategories.map(c => (
              <div key={c} className="nw-cat-pill">
                <span className="nw-cat-dot" style={{ background: CATEGORY_COLORS[c] }} />
                <span className="nw-cat-name">{c}</span>
                <span className="nw-cat-amt">{fmtFull(categoryTotals[c])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Liabilities from Loans page */}
      {loans.length > 0 && (
        <div className="card nw-card">
          <div className="nw-liab-header">
            <div>
              <h2>Liabilities</h2>
              <p className="bp-subtitle">Pulled from your Loans page. Edit balances there.</p>
            </div>
            <div className="nw-liab-total">
              <span className="nw-total-label">Total</span>
              <span className="nw-liab-val">−{fmtFull(totalLiabilities)}</span>
            </div>
          </div>
          <div className="nw-table-scroll">
            <table className="nw-table">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Balance</th>
                  <th>Rate</th>
                  <th>Months Left</th>
                  <th>Monthly Payment</th>
                </tr>
              </thead>
              <tbody>
                {loans.map(l => {
                  const r = l.annualRate / 100 / 12
                  const N = l.termMonths
                  const B = l.balance
                  const pmt = !N || B <= 0 ? 0
                    : l.annualRate === 0 ? B / N
                    : B * (r * Math.pow(1+r, N)) / (Math.pow(1+r, N) - 1)
                  return (
                    <tr key={l.id}>
                      <td className="nw-proj-name">{l.name || '—'}</td>
                      <td>
                        <div className="nw-num-wrap" style={{ opacity: 0.7 }}>
                          <span className="nw-prefix">$</span>
                          <span className="nw-num-input" style={{ padding: '4px 0' }}>{l.balance.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="nw-proj-meta">{l.annualRate}%</td>
                      <td className="nw-proj-meta">{l.termMonths}</td>
                      <td className="nw-liab-pmt">{fmtFull(pmt)}/mo</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projection table */}
      <div className="card nw-card">
        <h2>Future Value Projections</h2>
        <p className="bp-subtitle">Assumes contributions and growth rates stay constant. Not inflation-adjusted. Negative growth rates (e.g. vehicles) show depreciation.</p>
        <div className="nw-table-scroll">
          <table className="nw-proj-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Cat.</th>
                <th>Growth</th>
                <th>+/mo</th>
                {PROJ_YEARS.map(y => <th key={y}>{y}yr</th>)}
              </tr>
            </thead>
            <tbody>
              {projRows.map(row => (
                <tr key={row.id}>
                  <td className="nw-proj-name">{row.name || '—'}</td>
                  <td>
                    <span className="nw-proj-cat-dot" style={{ background: CATEGORY_COLORS[row.category] }} />
                  </td>
                  <td className={`nw-proj-meta ${row.growthRate < 0 ? 'nw-neg' : ''}`}>
                    {row.growthRate > 0 ? '+' : ''}{row.growthRate}%
                  </td>
                  <td className="nw-proj-meta">${row.monthlyContribution.toLocaleString()}</td>
                  {row.projections.map((val, i) => (
                    <td key={i} className={`nw-proj-val ${val < 0 ? 'nw-neg' : ''}`}>{fmt(val)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="nw-proj-footer">
                <td colSpan={4}>Total</td>
                {projTotals.map((t, i) => <td key={i}>{fmt(t)}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Projection chart */}
      {accounts.length > 0 && (
        <div className="card nw-card">
          <h2>30-Year Growth Projection</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tickFormatter={v => `yr ${v}`} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} width={64} />
              <Tooltip formatter={(v, name) => [fmtFull(v), name]} labelFormatter={v => `Year ${v}`} />
              <Legend />
              {activeCategories.map(c => (
                <Line key={c} type="monotone" dataKey={c}
                  stroke={CATEGORY_COLORS[c]} strokeWidth={2} dot={false} />
              ))}
              <Line type="monotone" dataKey="Total" stroke="#0f172a"
                strokeWidth={2} strokeDasharray="6 3" dot={false} />
              {loans.length > 0 && (
                <Line type="monotone" dataKey="Liabilities" stroke="#ef4444"
                  strokeWidth={2} strokeDasharray="4 2" dot={false} />
              )}
              {loans.length > 0 && (
                <Line type="monotone" dataKey="Net Worth" stroke="#10b981"
                  strokeWidth={2.5} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
