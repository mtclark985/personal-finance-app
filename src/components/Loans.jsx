import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const LOANS_KEY = 'finance_loans'

const DEFAULT_LOANS = [
  {
    id: 'l1', name: 'Mortgage',
    balance: 305000, annualRate: 6.5, termMonths: 334,
    startDate: '2023-01',
  },
  {
    id: 'l2', name: 'Car Loan',
    balance: 11000, annualRate: 5.9, termMonths: 39,
    startDate: '2024-06',
  },
]

function load() {
  try {
    const s = localStorage.getItem(LOANS_KEY)
    return s ? JSON.parse(s) : DEFAULT_LOANS
  } catch { return DEFAULT_LOANS }
}

function calcPayment(balance, annualRate, months) {
  if (!months || balance <= 0) return 0
  if (annualRate === 0) return balance / months
  const r = annualRate / 100 / 12
  return balance * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
}

function buildSchedule(balance, annualRate, months, extraPayment = 0, lumpSum = 0, lumpSumMonth = 1) {
  const r = annualRate / 100 / 12
  const basePayment = calcPayment(balance, annualRate, months)
  const schedule = []
  let remaining = balance
  let cumInterest = 0

  for (let mo = 1; mo <= months + 600 && remaining > 0.005; mo++) {
    if (mo === lumpSumMonth && lumpSum > 0) {
      remaining = Math.max(0, remaining - lumpSum)
      if (remaining <= 0.005) { remaining = 0; break }
    }
    const interest = remaining * r
    const payment = Math.min(basePayment + extraPayment, remaining + interest)
    const principal = payment - interest
    remaining = Math.max(0, remaining - principal)
    cumInterest += interest

    schedule.push({
      month: mo,
      payment:      +payment.toFixed(2),
      principal:    +principal.toFixed(2),
      interest:     +interest.toFixed(2),
      balance:      +remaining.toFixed(2),
      cumInterest:  +cumInterest.toFixed(2),
    })
  }
  return schedule
}

function payoffDate(startDate, months) {
  const [y, m] = startDate.split('-').map(Number)
  const d = new Date(y, m - 1 + months)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtC(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function fmtFull(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const SCENARIO_META = [
  { key: 'base',  label: 'Base',            color: '#64748b' },
  { key: 'extra', label: '+Extra/mo',        color: '#6366f1' },
  { key: 'lump',  label: 'Lump Sum',         color: '#f59e0b' },
  { key: 'both',  label: 'Extra + Lump Sum', color: '#10b981' },
]

export default function Loans() {
  const [loans, setLoans]             = useState(load)
  const [selectedId, setSelectedId]   = useState('l1')
  const [showAll, setShowAll]         = useState(false)
  const [extraPayment, setExtra]      = useState(0)
  const [lumpSum, setLump]            = useState(0)
  const [lumpSumMonth, setLumpMonth]  = useState(1)

  useEffect(() => {
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans))
    setAppData('loans', loans).catch(console.error)
  }, [loans])
  useEffect(() => { setExtra(0); setLump(0); setLumpMonth(1); setShowAll(false) }, [selectedId])

  function addLoan() {
    const id = crypto.randomUUID()
    setLoans(p => [...p, {
      id, name: '', balance: 0, annualRate: 6,
      termMonths: 60, startDate: new Date().toISOString().slice(0, 7),
    }])
    setSelectedId(id)
  }
  function upd(id, f, v) { setLoans(p => p.map(l => l.id === id ? { ...l, [f]: v } : l)) }
  function del(id) {
    setLoans(p => p.filter(l => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const loan = loans.find(l => l.id === selectedId) ?? null
  const totalBalance = loans.reduce((s, l) => s + l.balance, 0)

  const schedules = useMemo(() => {
    if (!loan) return null
    const { balance, annualRate, termMonths } = loan
    return {
      base:  buildSchedule(balance, annualRate, termMonths, 0, 0),
      extra: buildSchedule(balance, annualRate, termMonths, extraPayment, 0),
      lump:  buildSchedule(balance, annualRate, termMonths, 0, lumpSum, lumpSumMonth),
      both:  buildSchedule(balance, annualRate, termMonths, extraPayment, lumpSum, lumpSumMonth),
    }
  }, [loan, extraPayment, lumpSum, lumpSumMonth])

  const basePayment = loan ? calcPayment(loan.balance, loan.annualRate, loan.termMonths) : 0

  // Chart: balance by month for each scenario
  const chartData = useMemo(() => {
    if (!schedules) return []
    const maxLen = schedules.base.length
    return Array.from({ length: maxLen }, (_, i) => ({
      month: i + 1,
      Base:           schedules.base[i]?.balance  ?? 0,
      'Extra/mo':     schedules.extra[i]?.balance ?? 0,
      'Lump Sum':     schedules.lump[i]?.balance  ?? 0,
      'Extra + Lump': schedules.both[i]?.balance  ?? 0,
    }))
  }, [schedules])

  function summary(sched, base) {
    if (!sched.length || !base.length) return null
    const months        = sched.length
    const totalInterest = sched.at(-1).cumInterest
    const interestSaved = base.at(-1).cumInterest - totalInterest
    const monthsSaved   = base.length - months
    return { months, totalInterest, interestSaved, monthsSaved }
  }

  return (
    <div className="loans-planner">

      {/* Loan list */}
      <div className="card nw-card">
        <div className="loans-top-row">
          <div>
            <h2>Loans &amp; Liabilities</h2>
            <p className="loans-total-line">Total balance: <strong>{fmtFull(totalBalance)}</strong></p>
          </div>
          <button className="bp-add-row" onClick={addLoan}>+ Add loan</button>
        </div>

        <div className="loans-grid">
          {loans.length === 0 && <p className="bp-subtitle">No loans added yet.</p>}
          {loans.map(l => {
            const mp = calcPayment(l.balance, l.annualRate, l.termMonths)
            const active = selectedId === l.id
            return (
              <div key={l.id} className={`loan-card ${active ? 'loan-active' : ''}`}
                onClick={() => setSelectedId(active ? null : l.id)}>
                <div className="loan-card-head">
                  <input className="loan-name-input" value={l.name} placeholder="Loan name"
                    onClick={e => e.stopPropagation()}
                    onChange={e => upd(l.id, 'name', e.target.value)} />
                  <button className="nw-delete"
                    onClick={e => { e.stopPropagation(); del(l.id) }}>×</button>
                </div>
                <div className="loan-fields" onClick={e => e.stopPropagation()}>
                  <div className="loan-field">
                    <label>Balance</label>
                    <div className="nw-num-wrap sm">
                      <span className="nw-prefix">$</span>
                      <input type="number" min="0" step="100" className="nw-num-input"
                        value={l.balance || ''} placeholder="0"
                        onChange={e => upd(l.id, 'balance', parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div className="loan-field">
                    <label>Rate</label>
                    <div className="nw-num-wrap sm">
                      <input type="number" min="0" max="30" step="0.1" className="nw-num-input"
                        value={l.annualRate || ''} placeholder="0"
                        onChange={e => upd(l.id, 'annualRate', parseFloat(e.target.value) || 0)} />
                      <span className="nw-suffix">%</span>
                    </div>
                  </div>
                  <div className="loan-field">
                    <label>Months left</label>
                    <div className="nw-num-wrap sm">
                      <input type="number" min="1" step="1" className="nw-num-input"
                        value={l.termMonths || ''} placeholder="0"
                        onChange={e => upd(l.id, 'termMonths', parseInt(e.target.value) || 1)} />
                    </div>
                  </div>
                  <div className="loan-field">
                    <label>Start date</label>
                    <input type="month" className="loan-month-input" value={l.startDate}
                      onChange={e => upd(l.id, 'startDate', e.target.value)} />
                  </div>
                </div>
                <div className="loan-card-footer">
                  <span>Payment: <strong>{fmtC(mp)}/mo</strong></span>
                  <span>Payoff: <strong>{payoffDate(l.startDate, l.termMonths)}</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scenario Analysis */}
      {loan && schedules && (
        <div className="card nw-card">
          <h2>Scenario Analysis — {loan.name || 'Loan'}</h2>
          <p className="bp-subtitle">
            Base payment: <strong>{fmtC(basePayment)}/mo</strong>.
            Adjust the inputs to model payoff strategies.
          </p>

          <div className="scenario-inputs">
            <div className="scenario-field">
              <label>Extra Monthly Payment</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input type="number" min="0" step="50" className="nw-num-input"
                  value={extraPayment || ''} placeholder="0"
                  onChange={e => setExtra(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="scenario-field">
              <label>One-Time Lump Sum</label>
              <div className="nw-num-wrap">
                <span className="nw-prefix">$</span>
                <input type="number" min="0" step="500" className="nw-num-input"
                  value={lumpSum || ''} placeholder="0"
                  onChange={e => setLump(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="scenario-field">
              <label>Apply Lump Sum in Month #</label>
              <div className="nw-num-wrap">
                <input type="number" min="1" step="1" className="nw-num-input"
                  value={lumpSumMonth || ''} placeholder="1"
                  onChange={e => setLumpMonth(parseInt(e.target.value) || 1)} />
              </div>
            </div>
          </div>

          {/* Comparison cards */}
          <div className="scenario-grid">
            {SCENARIO_META.map(({ key, label, color }) => {
              const s = schedules[key]
              const b = schedules.base
              const sum = summary(s, b)
              if (!sum) return null
              const isBase = key === 'base'
              const active = (key === 'extra' && extraPayment > 0) ||
                             (key === 'lump'  && lumpSum > 0) ||
                             (key === 'both'  && extraPayment > 0 && lumpSum > 0) ||
                              key === 'base'
              if (!active) return null
              return (
                <div key={key} className="scenario-col" style={{ '--sc-color': color }}>
                  <div className="sc-label" style={{ color }}>{label}</div>
                  <div className="sc-stat">
                    <span className="sc-stat-name">Payoff</span>
                    <span className="sc-stat-val">{payoffDate(loan.startDate, sum.months)}</span>
                  </div>
                  <div className="sc-stat">
                    <span className="sc-stat-name">Months</span>
                    <span className="sc-stat-val">{sum.months}</span>
                  </div>
                  <div className="sc-stat">
                    <span className="sc-stat-name">Total Interest</span>
                    <span className="sc-stat-val">{fmtFull(sum.totalInterest)}</span>
                  </div>
                  {!isBase && (
                    <>
                      <div className="sc-stat sc-savings">
                        <span className="sc-stat-name">Months Saved</span>
                        <span className="sc-stat-val sc-green">
                          {sum.monthsSaved > 0 ? `−${sum.monthsSaved}` : '—'}
                        </span>
                      </div>
                      <div className="sc-stat sc-savings">
                        <span className="sc-stat-name">Interest Saved</span>
                        <span className="sc-stat-val sc-green">
                          {sum.interestSaved > 0 ? fmtFull(sum.interestSaved) : '—'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Balance chart */}
          <div className="scenario-chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 12, left: 8, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={v => `mo ${v}`} tick={{ fontSize: 11 }}
                  interval={Math.max(1, Math.floor(chartData.length / 7))} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={54} />
                <Tooltip formatter={(v, n) => [fmtFull(v), n]} labelFormatter={v => `Month ${v}`} />
                <Legend />
                <Line type="monotone" dataKey="Base" stroke="#64748b" strokeWidth={2} dot={false} />
                {extraPayment > 0 &&
                  <Line type="monotone" dataKey="Extra/mo" stroke="#6366f1" strokeWidth={2} dot={false} />}
                {lumpSum > 0 &&
                  <Line type="monotone" dataKey="Lump Sum" stroke="#f59e0b" strokeWidth={2} dot={false} />}
                {extraPayment > 0 && lumpSum > 0 &&
                  <Line type="monotone" dataKey="Extra + Lump" stroke="#10b981" strokeWidth={2} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Amortization table */}
      {loan && schedules && (
        <div className="card nw-card">
          <div className="amort-head">
            <div>
              <h2>Amortization Schedule</h2>
              <p className="bp-subtitle">
                {schedules.base.length} payments &nbsp;·&nbsp; {fmtC(basePayment)}/mo base payment
              </p>
            </div>
            <button className="bp-add-row" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less' : 'Show all'}
            </button>
          </div>

          <div className={`amort-scroll ${showAll ? 'amort-full' : ''}`}>
            <table className="amort-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Payment</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Balance</th>
                  <th>Cumul. Interest</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? schedules.base : schedules.base.slice(0, 24)).map(row => (
                  <tr key={row.month}>
                    <td className="amort-mo">{row.month}</td>
                    <td>{fmtC(row.payment)}</td>
                    <td className="amort-p">{fmtC(row.principal)}</td>
                    <td className="amort-i">{fmtC(row.interest)}</td>
                    <td>{fmtC(row.balance)}</td>
                    <td className="amort-cum">{fmtC(row.cumInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showAll && schedules.base.length > 24 && (
            <p className="amort-hint">
              Showing 24 of {schedules.base.length} payments.{' '}
              <button className="link-btn" onClick={() => setShowAll(true)}>Show all</button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
