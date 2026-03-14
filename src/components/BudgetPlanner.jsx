import { useState, useEffect, useCallback } from 'react'
import { setAppData } from '../lib/db'

const BUDGET_KEY = 'finance_budget'

const BLANK_EARNER = {
  baseSalary: 0, bonusTarget: 0, equityTarget: 0,
  federalTaxRate: 22, stateTaxRate: 5,
  retirement401k: 0, healthInsurance: 0, hsa: 0,
  otherPreTax: 0, otherPostTax: 0,
}

const DEFAULT_BUDGET = {
  earner1: {
    baseSalary: 90000, bonusTarget: 10000, equityTarget: 15000,
    federalTaxRate: 22, stateTaxRate: 5,
    retirement401k: 750, healthInsurance: 200, hsa: 150,
    otherPreTax: 0, otherPostTax: 100,
  },
  earner2: {
    baseSalary: 75000, bonusTarget: 7500, equityTarget: 10000,
    federalTaxRate: 22, stateTaxRate: 5,
    retirement401k: 600, healthInsurance: 0, hsa: 100,
    otherPreTax: 0, otherPostTax: 50,
  },
  fixedExpenses: [
    { id: 'f1', label: 'Mortgage / Rent',          amount: 1350 },
    { id: 'f2', label: 'Car Payment 1',             amount: 350  },
    { id: 'f3', label: 'Car Payment 2',             amount: 280  },
    { id: 'f4', label: 'Car Insurance',             amount: 180  },
    { id: 'f5', label: 'Health Insurance',          amount: 220  },
    { id: 'f6', label: 'Internet',                  amount: 60   },
    { id: 'f7', label: 'Phone Bills',               amount: 120  },
    { id: 'f8', label: 'Streaming & Subscriptions', amount: 55   },
  ],
  discretionary: [
    { id: 'd1', label: 'Groceries',      amount: 600 },
    { id: 'd2', label: 'Dining Out',     amount: 300 },
    { id: 'd3', label: 'Gas',            amount: 120 },
    { id: 'd4', label: 'Entertainment',  amount: 150 },
    { id: 'd5', label: 'Clothing',       amount: 150 },
    { id: 'd6', label: 'Personal Care',  amount: 80  },
    { id: 'd7', label: 'Travel',         amount: 200 },
    { id: 'd8', label: 'Miscellaneous',  amount: 150 },
  ],
}

function migrateEarner(old) {
  if (!old) return { ...BLANK_EARNER }
  // Old format had monthly grossIncome
  if ('grossIncome' in old && !('baseSalary' in old)) {
    const gross = old.grossIncome || 0
    const taxes = old.taxes || 0
    const totalTaxRate = gross > 0 ? (taxes / gross) * 100 : 27
    return {
      baseSalary:     gross * 12,
      bonusTarget:    0,
      equityTarget:   0,
      federalTaxRate: Math.max(0, Math.min(45, Math.round(totalTaxRate * 0.7))),
      stateTaxRate:   Math.max(0, Math.min(15, Math.round(totalTaxRate * 0.3))),
      retirement401k: old.retirementSavings || 0,
      healthInsurance: 0,
      hsa:            0,
      otherPreTax:    0,
      otherPostTax:   old.otherSavings || 0,
    }
  }
  return { ...BLANK_EARNER, ...old }
}

function loadBudget() {
  try {
    const stored = localStorage.getItem(BUDGET_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.income && !parsed.earner1) {
        return {
          earner1: migrateEarner(parsed.income),
          earner2: { ...BLANK_EARNER },
          fixedExpenses: parsed.fixedExpenses ?? DEFAULT_BUDGET.fixedExpenses,
          discretionary: parsed.discretionary ?? DEFAULT_BUDGET.discretionary,
        }
      }
      return {
        ...DEFAULT_BUDGET,
        ...parsed,
        earner1: migrateEarner(parsed.earner1),
        earner2: migrateEarner(parsed.earner2),
        fixedExpenses: parsed.fixedExpenses ?? DEFAULT_BUDGET.fixedExpenses,
        discretionary: parsed.discretionary ?? DEFAULT_BUDGET.discretionary,
      }
    }
    return DEFAULT_BUDGET
  } catch { return DEFAULT_BUDGET }
}

function getWorkingDays(year, month) {
  let count = 0
  const d = new Date(year, month - 1, 1)
  while (d.getMonth() === month - 1) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function computeIncome(data, workDays) {
  const baseSalary    = data.baseSalary    || 0
  const bonusTarget   = data.bonusTarget   || 0
  const equityTarget  = data.equityTarget  || 0
  const retirement401k = data.retirement401k || 0
  const healthIns     = data.healthInsurance || 0
  const hsa           = data.hsa           || 0
  const otherPreTax   = data.otherPreTax   || 0
  const otherPostTax  = data.otherPostTax  || 0

  const dailyRate     = baseSalary / 260
  const monthlyBase   = dailyRate * workDays
  const monthlyBonus  = bonusTarget  / 12
  const monthlyEquity = equityTarget / 12
  const grossMonthly  = monthlyBase + monthlyBonus + monthlyEquity

  // Pre-tax deductions reduce the taxable income base
  const preTaxDeductions = retirement401k + healthIns + hsa + otherPreTax
  const taxableIncome    = Math.max(0, grossMonthly - preTaxDeductions)

  const federalTax = taxableIncome * (data.federalTaxRate || 0) / 100
  const stateTax   = taxableIncome * (data.stateTaxRate   || 0) / 100
  const fica       = grossMonthly  * 0.0765 // SS 6.2% + Medicare 1.45%

  const netTakeHome = grossMonthly
    - federalTax - stateTax - fica
    - retirement401k - healthIns - hsa - otherPreTax - otherPostTax

  return {
    dailyRate, monthlyBase, monthlyBonus, monthlyEquity, grossMonthly,
    taxableIncome, federalTax, stateTax, fica, netTakeHome,
  }
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function fmt(n)  { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmt2(n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(part, total) {
  if (!total) return ''
  return `${((part / total) * 100).toFixed(0)}%`
}

function AmountInput({ value, onChange }) {
  return (
    <div className="bp-amount-wrap">
      <span className="bp-dollar">$</span>
      <input className="bp-amount-input" type="number" min="0" step="1"
        value={value === 0 ? '' : value} placeholder="0"
        onChange={e => onChange(parseFloat(e.target.value) || 0)} />
    </div>
  )
}

function PctInput({ value, onChange, max = 50 }) {
  return (
    <div className="bp-pct-input-wrap">
      <input className="bp-pct-input" type="number" min="0" max={max} step="0.1"
        value={value === 0 ? '' : value} placeholder="0"
        onChange={e => onChange(parseFloat(e.target.value) || 0)} />
      <span className="bp-pct-sign">%</span>
    </div>
  )
}

function EarnerIncome({ title, color, data, onChange, workDays }) {
  const c = computeIncome(data, workDays)

  return (
    <div className="bp-earner-col" style={{ '--ec': color }}>
      <div className="bp-earner-title" style={{ color }}>{title}</div>

      {/* ── Annual Compensation ── */}
      <div className="bp-section-label">Annual Compensation</div>
      <table className="bp-table">
        <tbody>
          <tr>
            <td className="bp-label">Base Salary</td>
            <td className="bp-input-cell" colSpan={2}>
              <AmountInput value={data.baseSalary} onChange={v => onChange('baseSalary', v)} />
            </td>
          </tr>
          <tr>
            <td className="bp-label">Bonus Target</td>
            <td className="bp-input-cell">
              <AmountInput value={data.bonusTarget} onChange={v => onChange('bonusTarget', v)} />
            </td>
            <td className="bp-pct-cell bp-muted">
              {data.baseSalary > 0 ? pct(data.bonusTarget || 0, data.baseSalary) : ''}
            </td>
          </tr>
          <tr>
            <td className="bp-label">Equity / RSU Target</td>
            <td className="bp-input-cell">
              <AmountInput value={data.equityTarget} onChange={v => onChange('equityTarget', v)} />
            </td>
            <td className="bp-pct-cell bp-muted">
              {data.baseSalary > 0 ? pct(data.equityTarget || 0, data.baseSalary) : ''}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Monthly Gross Breakdown (computed) ── */}
      <div className="bp-section-label bp-section-computed">
        Monthly Gross
        <span className="bp-work-days-badge">{workDays} working days</span>
      </div>
      <table className="bp-table bp-computed-table">
        <tbody>
          <tr>
            <td className="bp-label bp-muted">Daily Rate</td>
            <td className="bp-computed-val bp-muted" colSpan={2}>{fmt2(c.dailyRate)} / day</td>
          </tr>
          <tr>
            <td className="bp-label">Base Pay</td>
            <td className="bp-computed-val" colSpan={2}>{fmt(c.monthlyBase)}</td>
          </tr>
          {c.monthlyBonus > 0 && (
            <tr>
              <td className="bp-label bp-muted">+ Bonus (÷ 12)</td>
              <td className="bp-computed-val bp-muted" colSpan={2}>{fmt(c.monthlyBonus)}</td>
            </tr>
          )}
          {c.monthlyEquity > 0 && (
            <tr>
              <td className="bp-label bp-muted">+ Equity (÷ 12)</td>
              <td className="bp-computed-val bp-muted" colSpan={2}>{fmt(c.monthlyEquity)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bp-total-row">
            <td className="bp-label">Gross Monthly</td>
            <td className="bp-computed-val bp-total-val" colSpan={2}>{fmt(c.grossMonthly)}</td>
          </tr>
        </tfoot>
      </table>

      {/* ── Withholdings & Deductions ── */}
      <div className="bp-section-label">Withholdings & Deductions</div>
      <table className="bp-table">
        <thead>
          <tr>
            <th className="bp-col-hdr" />
            <th className="bp-col-hdr bp-col-hdr-rate">Rate / Amt</th>
            <th className="bp-col-hdr bp-col-hdr-result">Monthly</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="bp-label bp-deduction">Federal Tax</td>
            <td className="bp-input-cell">
              <PctInput value={data.federalTaxRate} onChange={v => onChange('federalTaxRate', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(c.federalTax)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">State Tax</td>
            <td className="bp-input-cell">
              <PctInput value={data.stateTaxRate} onChange={v => onChange('stateTaxRate', v)} max={20} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(c.stateTax)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">FICA <span className="bp-fica-note">(SS + Medicare)</span></td>
            <td className="bp-input-cell"><span className="bp-fixed-rate">7.65%</span></td>
            <td className="bp-pct-cell bp-neg">−{fmt(c.fica)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">401(k) / Retirement</td>
            <td className="bp-input-cell">
              <AmountInput value={data.retirement401k} onChange={v => onChange('retirement401k', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(data.retirement401k || 0)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">Health Insurance</td>
            <td className="bp-input-cell">
              <AmountInput value={data.healthInsurance} onChange={v => onChange('healthInsurance', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(data.healthInsurance || 0)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">HSA</td>
            <td className="bp-input-cell">
              <AmountInput value={data.hsa} onChange={v => onChange('hsa', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(data.hsa || 0)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">Other Pre-Tax</td>
            <td className="bp-input-cell">
              <AmountInput value={data.otherPreTax} onChange={v => onChange('otherPreTax', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(data.otherPreTax || 0)}</td>
          </tr>
          <tr>
            <td className="bp-label bp-deduction">Other Post-Tax</td>
            <td className="bp-input-cell">
              <AmountInput value={data.otherPostTax} onChange={v => onChange('otherPostTax', v)} />
            </td>
            <td className="bp-pct-cell bp-neg">−{fmt(data.otherPostTax || 0)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="bp-total-row bp-takehome" style={{ '--tc': color }}>
            <td className="bp-label" style={{ color }}>Net Take-Home</td>
            <td className="bp-input-cell bp-total-val" style={{ color }}>{fmt(c.netTakeHome)}</td>
            <td className="bp-pct-cell bp-muted">{pct(c.netTakeHome, c.grossMonthly)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function BudgetPlanner({ household, earnerView }) {
  const now = new Date()
  const [incomeYear,  setIncomeYear]  = useState(now.getFullYear())
  const [incomeMonth, setIncomeMonth] = useState(now.getMonth() + 1)
  const [budget, setBudget] = useState(loadBudget)

  useEffect(() => {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget))
    setAppData('budget', budget).catch(console.error)
  }, [budget])

  const setEarnerField = useCallback((earner, field, value) => {
    setBudget(b => ({ ...b, [earner]: { ...b[earner], [field]: value } }))
  }, [])

  const setListItem = useCallback((section, id, field, value) => {
    setBudget(b => ({
      ...b,
      [section]: b[section].map(row => row.id === id ? { ...row, [field]: value } : row),
    }))
  }, [])

  const addRow = useCallback((section) => {
    setBudget(b => ({ ...b, [section]: [...b[section], { id: crypto.randomUUID(), label: '', amount: 0 }] }))
  }, [])

  const deleteRow = useCallback((section, id) => {
    setBudget(b => ({ ...b, [section]: b[section].filter(r => r.id !== id) }))
  }, [])

  const p1 = household?.p1 || 'Person 1'
  const p2 = household?.p2 || 'Person 2'

  const workDays = getWorkingDays(incomeYear, incomeMonth)
  const showBoth = earnerView === 'combined' || !earnerView
  const showP1   = showBoth || earnerView === 'p1'
  const showP2   = showBoth || earnerView === 'p2'

  const c1 = computeIncome(budget.earner1, workDays)
  const c2 = computeIncome(budget.earner2, workDays)

  const th1 = showP1 ? c1.netTakeHome : 0
  const th2 = showP2 ? c2.netTakeHome : 0
  const combinedTakeHome   = th1 + th2
  const totalFixed         = budget.fixedExpenses.reduce((s, r) => s + r.amount, 0)
  const totalDiscretionary = budget.discretionary.reduce((s, r) => s + r.amount, 0)
  const remaining          = combinedTakeHome - totalFixed - totalDiscretionary

  // Month picker options: prev year through next year
  const monthOptions = []
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
    for (let m = 1; m <= 12; m++) monthOptions.push({ year: y, month: m })
  }

  return (
    <div className="budget-planner">

      {/* ── Income ── */}
      <div className="card bp-card">
        <div className="bp-card-header">
          <h2>Income</h2>
          <div className="bp-month-picker">
            <span className="bp-month-label">Calculate for</span>
            <select className="bp-month-select"
              value={`${incomeYear}-${incomeMonth}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number)
                setIncomeYear(y); setIncomeMonth(m)
              }}
            >
              {monthOptions.map(({ year, month }) => (
                <option key={`${year}-${month}`} value={`${year}-${month}`}>
                  {MONTH_NAMES[month - 1]} {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bp-dual-income">
          {showP1 && (
            <EarnerIncome title={p1} color="#6366f1"
              data={budget.earner1}
              onChange={(f, v) => setEarnerField('earner1', f, v)}
              workDays={workDays} />
          )}
          {showP2 && (
            <EarnerIncome title={p2} color="#ec4899"
              data={budget.earner2}
              onChange={(f, v) => setEarnerField('earner2', f, v)}
              workDays={workDays} />
          )}
        </div>

        {showBoth && (
          <div className="bp-combined-row">
            <span className="bp-combined-label">Combined Net Take-Home</span>
            <span className="bp-combined-val">{fmt(combinedTakeHome)}</span>
          </div>
        )}
      </div>

      {/* ── Fixed Expenses ── */}
      <div className="card bp-card">
        <h2>Fixed Monthly Expenses</h2>
        <p className="bp-subtitle">Recurring household bills — shared between earners.</p>
        <table className="bp-table">
          <tbody>
            {budget.fixedExpenses.map(row => (
              <tr key={row.id}>
                <td className="bp-label">
                  <input className="bp-label-input" type="text" value={row.label}
                    placeholder="Expense name"
                    onChange={e => setListItem('fixedExpenses', row.id, 'label', e.target.value)} />
                </td>
                <td className="bp-input-cell">
                  <AmountInput value={row.amount}
                    onChange={v => setListItem('fixedExpenses', row.id, 'amount', v)} />
                </td>
                <td className="bp-pct-cell bp-muted">{pct(row.amount, combinedTakeHome)}</td>
                <td className="bp-delete-cell">
                  <button className="bp-delete" onClick={() => deleteRow('fixedExpenses', row.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}><button className="bp-add-row" onClick={() => addRow('fixedExpenses')}>+ Add row</button></td></tr>
            <tr className="bp-total-row">
              <td className="bp-label">Total Fixed</td>
              <td className="bp-input-cell bp-total-val">{fmt(totalFixed)}</td>
              <td className="bp-pct-cell bp-muted">{pct(totalFixed, combinedTakeHome)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Discretionary ── */}
      <div className="card bp-card">
        <h2>Discretionary Spending</h2>
        <p className="bp-subtitle">Variable household spending you control month to month.</p>
        <table className="bp-table">
          <tbody>
            {budget.discretionary.map(row => (
              <tr key={row.id}>
                <td className="bp-label">
                  <input className="bp-label-input" type="text" value={row.label}
                    placeholder="Expense name"
                    onChange={e => setListItem('discretionary', row.id, 'label', e.target.value)} />
                </td>
                <td className="bp-input-cell">
                  <AmountInput value={row.amount}
                    onChange={v => setListItem('discretionary', row.id, 'amount', v)} />
                </td>
                <td className="bp-pct-cell bp-muted">{pct(row.amount, combinedTakeHome)}</td>
                <td className="bp-delete-cell">
                  <button className="bp-delete" onClick={() => deleteRow('discretionary', row.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}><button className="bp-add-row" onClick={() => addRow('discretionary')}>+ Add row</button></td></tr>
            <tr className="bp-total-row">
              <td className="bp-label">Total Discretionary</td>
              <td className="bp-input-cell bp-total-val">{fmt(totalDiscretionary)}</td>
              <td className="bp-pct-cell bp-muted">{pct(totalDiscretionary, combinedTakeHome)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Summary ── */}
      <div className="card bp-card bp-summary-card">
        <h2>Monthly Budget Summary</h2>
        <div className="bp-summary-rows">
          {showBoth && (
            <>
              <div className="bp-summary-row">
                <span style={{ color: '#6366f1' }}>{p1} Take-Home</span>
                <span className="bp-summary-income" style={{ color: '#6366f1' }}>{fmt(c1.netTakeHome)}</span>
              </div>
              <div className="bp-summary-row">
                <span style={{ color: '#ec4899' }}>{p2} Take-Home</span>
                <span className="bp-summary-income" style={{ color: '#ec4899' }}>{fmt(c2.netTakeHome)}</span>
              </div>
              <div className="bp-summary-divider" />
            </>
          )}
          <div className="bp-summary-row">
            <span>Combined Take-Home</span>
            <span className="bp-summary-income">{fmt(combinedTakeHome)}</span>
          </div>
          <div className="bp-summary-row">
            <span>Fixed Expenses</span>
            <span className="bp-summary-expense">−{fmt(totalFixed)}</span>
          </div>
          <div className="bp-summary-row">
            <span>Discretionary Spending</span>
            <span className="bp-summary-expense">−{fmt(totalDiscretionary)}</span>
          </div>
          <div className="bp-summary-divider" />
          <div className="bp-summary-row bp-summary-net">
            <span>Remaining / Unbudgeted</span>
            <span className={remaining >= 0 ? 'bp-positive' : 'bp-negative'}>{fmt(remaining)}</span>
          </div>
        </div>

        <div className="bp-bar-wrap">
          {combinedTakeHome > 0 && (
            <>
              <div className="bp-bar-segment bp-bar-fixed"
                style={{ width: `${Math.min((totalFixed / combinedTakeHome) * 100, 100)}%` }}
                title={`Fixed: ${fmt(totalFixed)}`} />
              <div className="bp-bar-segment bp-bar-disc"
                style={{ width: `${Math.min((totalDiscretionary / combinedTakeHome) * 100, 100)}%` }}
                title={`Discretionary: ${fmt(totalDiscretionary)}`} />
            </>
          )}
        </div>
        <div className="bp-bar-legend">
          <span><span className="bp-legend-dot bp-bar-fixed" />Fixed</span>
          <span><span className="bp-legend-dot bp-bar-disc" />Discretionary</span>
          <span><span className="bp-legend-dot bp-bar-remaining" />Remaining</span>
        </div>
      </div>

    </div>
  )
}
