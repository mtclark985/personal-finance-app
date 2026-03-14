import { useState, useEffect, useMemo } from 'react'
import { setAppData } from '../lib/db'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'

const TAX_KEY    = 'sage_tax'
const BUDGET_KEY = 'finance_budget'

// ── 2025 Tax Constants ────────────────────────────────────────
const SS_WAGE_BASE = 176_100

const BRACKETS = {
  single: [
    { rate: 0.10, min: 0,       max: 11_925    },
    { rate: 0.12, min: 11_925,  max: 48_475    },
    { rate: 0.22, min: 48_475,  max: 103_350   },
    { rate: 0.24, min: 103_350, max: 197_300   },
    { rate: 0.32, min: 197_300, max: 250_525   },
    { rate: 0.35, min: 250_525, max: 626_350   },
    { rate: 0.37, min: 626_350, max: Infinity  },
  ],
  mfj: [
    { rate: 0.10, min: 0,       max: 23_850    },
    { rate: 0.12, min: 23_850,  max: 96_950    },
    { rate: 0.22, min: 96_950,  max: 206_700   },
    { rate: 0.24, min: 206_700, max: 394_600   },
    { rate: 0.32, min: 394_600, max: 501_050   },
    { rate: 0.35, min: 501_050, max: 751_600   },
    { rate: 0.37, min: 751_600, max: Infinity  },
  ],
  mfs: [
    { rate: 0.10, min: 0,       max: 11_925    },
    { rate: 0.12, min: 11_925,  max: 48_475    },
    { rate: 0.22, min: 48_475,  max: 103_350   },
    { rate: 0.24, min: 103_350, max: 197_300   },
    { rate: 0.32, min: 197_300, max: 250_525   },
    { rate: 0.35, min: 250_525, max: 375_800   },
    { rate: 0.37, min: 375_800, max: Infinity  },
  ],
  hoh: [
    { rate: 0.10, min: 0,       max: 17_000    },
    { rate: 0.12, min: 17_000,  max: 64_850    },
    { rate: 0.22, min: 64_850,  max: 103_350   },
    { rate: 0.24, min: 103_350, max: 197_300   },
    { rate: 0.32, min: 197_300, max: 250_500   },
    { rate: 0.35, min: 250_500, max: 626_350   },
    { rate: 0.37, min: 626_350, max: Infinity  },
  ],
}

const STD_DEDUCTION  = { single: 15_000, mfj: 30_000, mfs: 15_000, hoh: 22_500 }

const LTCG_BRACKETS = {
  single: [ { rate: 0.00, max: 48_350   }, { rate: 0.15, max: 533_400  }, { rate: 0.20, max: Infinity } ],
  mfj:    [ { rate: 0.00, max: 96_700   }, { rate: 0.15, max: 600_050  }, { rate: 0.20, max: Infinity } ],
  mfs:    [ { rate: 0.00, max: 48_350   }, { rate: 0.15, max: 300_000  }, { rate: 0.20, max: Infinity } ],
  hoh:    [ { rate: 0.00, max: 64_750   }, { rate: 0.15, max: 566_700  }, { rate: 0.20, max: Infinity } ],
}

const NIIT_THRESHOLD      = { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 }
const ADD_MED_THRESHOLD   = { single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000 }
const CTC_PHASEOUT        = { single: 200_000, mfj: 400_000, mfs: 200_000, hoh: 200_000 }
const SALT_CAP            = 10_000
const IRA_LIMIT           = 7_000
const STUDENT_LOAN_LIMIT  = 2_500

const BRACKET_COLORS = ['#34d399','#22d3ee','#60a5fa','#818cf8','#a78bfa','#f472b6','#f87171']

// ── Helpers ───────────────────────────────────────────────────
function calcOrdinaryTax(taxableIncome, brackets) {
  let tax = 0
  for (const { rate, min, max } of brackets) {
    if (taxableIncome <= min) break
    tax += (Math.min(taxableIncome, max) - min) * rate
  }
  return tax
}

function bracketBreakdown(taxableIncome, brackets) {
  return brackets.map(({ rate, min, max }, i) => {
    const inBracket = Math.max(0, Math.min(taxableIncome, max) - min)
    return { rate, min, max: max === Infinity ? '∞' : max, inBracket, tax: inBracket * rate, color: BRACKET_COLORS[i] }
  }).filter(b => b.inBracket > 0 || b.min === 0)
}

function getMarginalRate(taxableIncome, brackets) {
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (taxableIncome > brackets[i].min) return brackets[i].rate
  }
  return brackets[0].rate
}

function calcLTCGTax(ltcg, ordinaryTaxableIncome, ltcgBrackets) {
  if (ltcg <= 0) return 0
  let tax = 0, remaining = ltcg
  const base = Math.max(0, ordinaryTaxableIncome)
  for (const { rate, max } of ltcgBrackets) {
    if (base >= max || remaining <= 0) continue
    const room = max - Math.max(base, 0)
    const taxable = Math.min(remaining, room)
    tax += taxable * rate
    remaining -= taxable
  }
  return tax
}

function calcSETax(netSEIncome) {
  if (netSEIncome <= 0) return { seTax: 0, seDeduction: 0 }
  const base = netSEIncome * 0.9235
  const ssTax      = Math.min(base, SS_WAGE_BASE) * 0.124
  const medTax     = base * 0.029
  const seTax      = ssTax + medTax
  return { seTax, seDeduction: seTax / 2 }
}

function calcFICA(wages, addlMedThreshold) {
  const ss   = Math.min(wages, SS_WAGE_BASE) * 0.062
  const med  = wages * 0.0145
  const addl = Math.max(0, wages - addlMedThreshold) * 0.009
  return ss + med + addl
}

function clamp(v) { return Math.max(0, v) }
function fmt(n) { return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmtD(n) { return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) }
function pct(n) { return `${(n * 100).toFixed(2)}%` }

// ── Load / defaults ───────────────────────────────────────────
function readBudget() {
  try {
    const s = localStorage.getItem(BUDGET_KEY)
    if (!s) return null
    const b = JSON.parse(s)
    const e1 = b.earner1 ?? b.income ?? {}
    const e2 = b.earner2 ?? {}
    // New format: baseSalary + bonusTarget + equityTarget are already annual
    // Old format: grossIncome is monthly, multiply by 12
    const e1Annual = 'baseSalary' in e1
      ? (e1.baseSalary || 0) + (e1.bonusTarget || 0) + (e1.equityTarget || 0)
      : (e1.grossIncome || 0) * 12
    const e2Annual = 'baseSalary' in e2
      ? (e2.baseSalary || 0) + (e2.bonusTarget || 0) + (e2.equityTarget || 0)
      : (e2.grossIncome || 0) * 12
    return {
      p1Wages: Math.round(e1Annual),
      p2Wages: Math.round(e2Annual),
      p1Retirement: Math.round((e1.retirement401k || e1.retirementSavings || 0) * 12),
      p2Retirement: Math.round((e2.retirement401k || e2.retirementSavings || 0) * 12),
    }
  } catch { return null }
}

const DEFAULTS = {
  filingStatus: 'mfj',
  childrenUnder17: 2,
  otherDependents: 0,
  autoSync: true,
  p1: { wages: 72_000, selfEmpNet: 0,  stGains: 0, ltGains: 0, otherIncome: 0, withholding: 10_500 },
  p2: { wages: 48_000, selfEmpNet: 0,  stGains: 0, ltGains: 0, otherIncome: 0, withholding: 6_800  },
  studentLoanInterest: 0,
  iraContrib: 0,
  hsaContrib: 0,
  otherAdjustments: 0,
  useStandard: true,
  mortgageInterest: 14_000,
  stateTaxesPaid: 8_000,
  propertyTax: 5_200,
  charitable: 1_200,
  otherItemized: 0,
  childCareCosts: 0,
  educationCredit: 0,
  otherCredits: 0,
  inclState: false,
  stateRate: 5.0,
  qtrPaid: 0,
}

function load() {
  try {
    const s = localStorage.getItem(TAX_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      return {
        ...DEFAULTS,
        ...parsed,
        p1: { ...DEFAULTS.p1, ...(parsed.p1 || {}) },
        p2: { ...DEFAULTS.p2, ...(parsed.p2 || {}) },
      }
    }
    return DEFAULTS
  } catch { return DEFAULTS }
}

// ── Sub-components ─────────────────────────────────────────────
function Field({ label, value, onChange, prefix = '$', suffix = '', step = 100, min = 0, hint, readOnly, highlight }) {
  return (
    <div className="rc-field">
      <label className="rc-label">{label}</label>
      {hint && <span className="rc-hint">{hint}</span>}
      {readOnly
        ? <div className={`tax-readonly ${highlight ? 'tax-highlight' : ''}`}>{prefix}{value.toLocaleString()}{suffix}</div>
        : (
          <div className="nw-num-wrap" style={{ width: 'fit-content' }}>
            {prefix && <span className="nw-prefix">{prefix}</span>}
            <input className="nw-num-input" type="number" min={min} step={step}
              value={value || ''} placeholder="0"
              onChange={e => onChange(parseFloat(e.target.value) || 0)} />
            {suffix && <span className="nw-suffix">{suffix}</span>}
          </div>
        )
      }
    </div>
  )
}

function EarnerIncomeBlock({ title, color, data, onChange }) {
  return (
    <div className="bp-earner-col" style={{ '--ec': color }}>
      <div className="bp-earner-title" style={{ color }}>{title}</div>
      <div className="rc-fields">
        <Field label="W-2 Wages"                 value={data.wages}       step={1000} onChange={v => onChange('wages', v)} />
        <Field label="Self-Employment Net Income" value={data.selfEmpNet}  step={1000} onChange={v => onChange('selfEmpNet', v)} hint="After business expenses" />
        <Field label="Short-Term Capital Gains"  value={data.stGains}     step={500}  onChange={v => onChange('stGains', v)} />
        <Field label="Long-Term Gains / QDivs"   value={data.ltGains}     step={500}  onChange={v => onChange('ltGains', v)} />
        <Field label="Other Taxable Income"      value={data.otherIncome} step={500}  onChange={v => onChange('otherIncome', v)} />
        <Field label="W-2 Federal Withholding"   value={data.withholding} step={500}  onChange={v => onChange('withholding', v)} hint="From your W-2 box 2" />
      </div>
    </div>
  )
}

function WaterfallRow({ label, value, indent = false, bold = false, border = false, color }) {
  const sign = value < 0 ? '−' : value > 0 ? '' : ''
  return (
    <tr className={`wf-row ${bold ? 'wf-bold' : ''} ${border ? 'wf-border' : ''}`}>
      <td className={`wf-label ${indent ? 'wf-indent' : ''}`}>{label}</td>
      <td className="wf-val" style={{ color }}>{value < 0 ? `(${fmt(-value)})` : fmt(value)}</td>
    </tr>
  )
}

// ── Main Component ─────────────────────────────────────────────
export default function TaxEstimator({ household, earnerView }) {
  const [d, setD] = useState(load)

  useEffect(() => {
    localStorage.setItem(TAX_KEY, JSON.stringify(d))
    setAppData('tax', d).catch(console.error)
  }, [d])

  const p1 = household?.p1 || 'Person 1'
  const p2 = household?.p2 || 'Person 2'
  const showBoth = earnerView === 'combined' || !earnerView

  // Auto-sync wages from budget planner
  const budgetSync = useMemo(() => readBudget(), [])
  useEffect(() => {
    if (d.autoSync && budgetSync) {
      setD(prev => ({
        ...prev,
        p1: { ...prev.p1, wages: budgetSync.p1Wages },
        p2: { ...prev.p2, wages: budgetSync.p2Wages },
        iraContrib: Math.min(
          IRA_LIMIT * (showBoth ? 2 : 1),
          (budgetSync.p1Retirement + (showBoth ? budgetSync.p2Retirement : 0)) / 12 * 12
        ),
      }))
    }
  }, [d.autoSync, budgetSync]) // eslint-disable-line

  function set(field, val) { setD(prev => ({ ...prev, [field]: val })) }
  function setP(person, field, val) { setD(prev => ({ ...prev, [person]: { ...prev[person], [field]: val } })) }

  const fs = d.filingStatus
  const brackets = BRACKETS[fs]

  // ── Tax Calculation ──────────────────────────────────────────
  const calc = useMemo(() => {
    // Which earner data to include
    const includeP1 = showBoth || earnerView === 'p1'
    const includeP2 = showBoth || earnerView === 'p2'
    const e1 = includeP1 ? d.p1 : { wages: 0, selfEmpNet: 0, stGains: 0, ltGains: 0, otherIncome: 0, withholding: 0 }
    const e2 = includeP2 ? d.p2 : { wages: 0, selfEmpNet: 0, stGains: 0, ltGains: 0, otherIncome: 0, withholding: 0 }

    const totalWages       = e1.wages + e2.wages
    const totalSENet       = e1.selfEmpNet + e2.selfEmpNet
    const totalSTGains     = e1.stGains + e2.stGains
    const totalLTGains     = e1.ltGains + e2.ltGains
    const totalOther       = e1.otherIncome + e2.otherIncome
    const totalWithholding = e1.withholding + e2.withholding

    // SE Tax (each earner calculated separately, but we combine)
    const se1 = calcSETax(e1.selfEmpNet)
    const se2 = calcSETax(e2.selfEmpNet)
    const totalSETax       = se1.seTax + se2.seTax
    const totalSEDeduction = se1.seDeduction + se2.seDeduction

    // Gross income (ordinary + LTCG)
    const grossOrdinary = totalWages + totalSENet + totalSTGains + totalOther
    const grossIncome   = grossOrdinary + totalLTGains

    // Above-the-line adjustments
    const studentLoanAdj = Math.min(d.studentLoanInterest, STUDENT_LOAN_LIMIT)
    const iraAdj         = Math.min(d.iraContrib, IRA_LIMIT * (showBoth && fs === 'mfj' ? 2 : 1))
    const totalAdjustments = totalSEDeduction + studentLoanAdj + clamp(d.hsaContrib) + iraAdj + clamp(d.otherAdjustments)

    const agi = clamp(grossIncome - totalAdjustments)

    // Deduction
    const itemizedMortgage   = clamp(d.mortgageInterest)
    const itemizedSALT       = Math.min(clamp(d.stateTaxesPaid) + clamp(d.propertyTax), SALT_CAP)
    const itemizedCharitable = clamp(d.charitable)
    const itemizedOther      = clamp(d.otherItemized)
    const totalItemized      = itemizedMortgage + itemizedSALT + itemizedCharitable + itemizedOther
    const stdDed             = STD_DEDUCTION[fs]
    const deduction          = d.useStandard ? stdDed : Math.max(totalItemized, stdDed)

    // Taxable income (ordinary portion — LTCG stacked on top)
    const ordinaryTaxable = clamp(agi - totalLTGains - deduction)
    const totalTaxable    = clamp(agi - deduction)

    // Ordinary income tax
    const ordinaryTax = calcOrdinaryTax(ordinaryTaxable, brackets)

    // LTCG tax (stacked on top of ordinary)
    const ltcgTax = calcLTCGTax(totalLTGains, ordinaryTaxable, LTCG_BRACKETS[fs])

    // NIIT (3.8% on investment income above AGI threshold)
    const niitThreshold     = NIIT_THRESHOLD[fs]
    const investmentIncome  = totalLTGains + totalSTGains
    const niitSubject        = Math.min(investmentIncome, Math.max(0, agi - niitThreshold))
    const niitTax            = niitSubject * 0.038

    // Child tax credit
    const ctcPhaseoutThresh = CTC_PHASEOUT[fs]
    const ctcOverage         = Math.max(0, agi - ctcPhaseoutThresh)
    const ctcReduction       = Math.floor(ctcOverage / 1_000) * 50
    const rawCTC             = d.childrenUnder17 * 2_000
    const childTaxCredit     = Math.max(0, rawCTC - ctcReduction)

    // Child/dependent care credit (simplified: 20% of eligible expenses up to $3k/$6k)
    const careCap            = (d.childrenUnder17 + d.otherDependents) >= 2 ? 6_000 : 3_000
    const careCredit         = Math.min(d.childCareCosts, careCap) * 0.20

    const totalCredits       = childTaxCredit + careCredit + clamp(d.educationCredit) + clamp(d.otherCredits)

    // Federal income tax (after credits)
    const fedBeforeCredits   = ordinaryTax + ltcgTax + niitTax
    const fedAfterCredits    = clamp(fedBeforeCredits - totalCredits)
    const totalFederal       = fedAfterCredits + totalSETax

    // FICA (employee portion, on W-2 wages)
    const addlMedThresh      = ADD_MED_THRESHOLD[fs]
    const fica1              = includeP1 ? calcFICA(e1.wages, addlMedThresh) : 0
    const fica2              = includeP2 ? calcFICA(e2.wages, addlMedThresh) : 0
    const totalFICA          = fica1 + fica2

    // State tax (simplified flat rate on taxable income)
    const stateTax           = d.inclState ? totalTaxable * (d.stateRate / 100) : 0

    // Totals
    const totalTaxBurden     = totalFederal + totalFICA + stateTax
    const afterTaxIncome     = clamp(grossIncome - totalTaxBurden)
    const effectiveRate      = grossIncome > 0 ? totalTaxBurden / grossIncome : 0
    const marginalRate       = getMarginalRate(ordinaryTaxable, brackets)

    // Withholding reconciliation
    const totalPrepaid       = totalWithholding + clamp(d.qtrPaid)
    const balanceDue         = totalFederal - totalPrepaid + stateTax // simplified: fed + state vs. withholding
    const qtrPaymentNeeded   = totalSENet > 400 ? clamp(totalFederal + stateTax - totalWithholding) / 4 : 0

    // Bracket breakdown
    const bkdown             = bracketBreakdown(ordinaryTaxable, brackets)

    return {
      grossIncome, grossOrdinary, totalWages, totalSENet, totalSTGains, totalLTGains, totalOther,
      totalAdjustments, totalSEDeduction, studentLoanAdj, iraAdj,
      agi, deduction, stdDed, totalItemized,
      ordinaryTaxable, totalTaxable,
      ordinaryTax, ltcgTax, niitTax, niitSubject,
      fedBeforeCredits, childTaxCredit, careCredit, totalCredits, fedAfterCredits,
      totalSETax, totalFederal,
      fica1, fica2, totalFICA,
      stateTax, totalTaxBurden, afterTaxIncome,
      effectiveRate, marginalRate,
      totalWithholding, totalPrepaid, balanceDue, qtrPaymentNeeded,
      bkdown,
      e1, e2, se1, se2, fica1, fica2,
    }
  }, [d, fs, brackets, earnerView, showBoth])

  const c = calc

  // Pie data
  const pieData = [
    { name: 'Federal Income Tax', value: Math.round(c.fedAfterCredits), color: '#6366f1' },
    { name: 'SE Tax',             value: Math.round(c.totalSETax),      color: '#8b5cf6' },
    { name: 'FICA',               value: Math.round(c.totalFICA),       color: '#3b82f6' },
    { name: 'State Tax',          value: Math.round(c.stateTax),        color: '#f59e0b' },
    { name: 'Take-Home',          value: Math.round(c.afterTaxIncome),  color: '#10b981' },
  ].filter(d => d.value > 0)

  return (
    <div className="tax-page">

      {/* Disclaimer */}
      <div className="tax-disclaimer">
        <strong>Estimation only</strong> — This tool uses simplified 2025 federal tax rules. Consult a tax professional for filing. Numbers exclude AMT, phase-outs beyond those modeled, and complex scenarios.
      </div>

      {/* ── Filing Setup ── */}
      <div className="card rc-card">
        <h2>Filing Setup — Tax Year 2025</h2>
        <div className="tax-setup-row">
          <div className="rc-field">
            <label className="rc-label">Filing Status</label>
            <select className="nw-select" value={d.filingStatus} onChange={e => set('filingStatus', e.target.value)}>
              <option value="single">Single</option>
              <option value="mfj">Married Filing Jointly (MFJ)</option>
              <option value="mfs">Married Filing Separately (MFS)</option>
              <option value="hoh">Head of Household</option>
            </select>
          </div>
          <Field label="Children Under 17" value={d.childrenUnder17} step={1} prefix="" min={0}
            hint="For child tax credit" onChange={v => set('childrenUnder17', v)} />
          <Field label="Other Dependents" value={d.otherDependents} step={1} prefix="" min={0}
            hint="For dependent care credit" onChange={v => set('otherDependents', v)} />
          {budgetSync && (
            <label className="rc-sync-toggle" style={{ marginTop: 20 }}>
              <input type="checkbox" checked={d.autoSync} onChange={e => set('autoSync', e.target.checked)} />
              Sync wages from Budget Planner
            </label>
          )}
        </div>
      </div>

      {/* ── Income ── */}
      <div className="card rc-card">
        <h2>Income</h2>
        <div className="bp-dual-income">
          {(showBoth || earnerView === 'p1') && (
            <EarnerIncomeBlock title={p1} color="#6366f1" data={d.p1}
              onChange={(f, v) => setP('p1', f, v)} />
          )}
          {(showBoth || earnerView === 'p2') && (
            <EarnerIncomeBlock title={p2} color="#ec4899" data={d.p2}
              onChange={(f, v) => setP('p2', f, v)} />
          )}
        </div>
        {showBoth && (
          <div className="bp-combined-row" style={{ marginTop: 14 }}>
            <span className="bp-combined-label">Combined Gross Income</span>
            <span className="bp-combined-val">{fmt(c.grossIncome)}</span>
          </div>
        )}
      </div>

      <div className="tax-mid-grid">

        {/* ── Adjustments ── */}
        <div className="card rc-card">
          <h2>Above-the-Line Deductions</h2>
          <p className="bp-subtitle">Reduce your AGI regardless of itemizing.</p>
          <div className="rc-fields">
            <Field label="SE Tax Deduction" value={Math.round(c.totalSEDeduction)} readOnly
              hint="Auto-calculated (50% of SE tax)" />
            <Field label="Traditional IRA Contributions" value={d.iraContrib} step={500}
              hint={`2025 limit: $${IRA_LIMIT.toLocaleString()}/person`}
              onChange={v => set('iraContrib', v)} />
            <Field label="HSA Contributions" value={d.hsaContrib} step={100}
              hint="Pre-tax HSA deposits"
              onChange={v => set('hsaContrib', v)} />
            <Field label="Student Loan Interest" value={d.studentLoanInterest} step={100}
              hint={`Deductible up to $${STUDENT_LOAN_LIMIT.toLocaleString()}`}
              onChange={v => set('studentLoanInterest', v)} />
            <Field label="Other Adjustments" value={d.otherAdjustments} step={100}
              onChange={v => set('otherAdjustments', v)} />
          </div>
          <div className="rc-derived-row">
            <span>Total adjustments</span>
            <strong className="rc-red">({fmt(c.totalAdjustments)})</strong>
          </div>
          <div className="rc-derived-row" style={{ borderTop: '2px solid var(--primary)', color: 'var(--primary)' }}>
            <span style={{ fontWeight: 700 }}>Adjusted Gross Income (AGI)</span>
            <strong>{fmt(c.agi)}</strong>
          </div>
        </div>

        {/* ── Deductions ── */}
        <div className="card rc-card">
          <h2>Deductions</h2>
          <div className="tax-ded-toggle">
            <button className={d.useStandard ? 'active' : ''} onClick={() => set('useStandard', true)}>
              Standard ({fmt(c.stdDed)})
            </button>
            <button className={!d.useStandard ? 'active' : ''} onClick={() => set('useStandard', false)}>
              Itemized {!d.useStandard && c.totalItemized > c.stdDed ? '✓ Better' : ''}
            </button>
          </div>

          {!d.useStandard ? (
            <div className="rc-fields" style={{ marginTop: 12 }}>
              <Field label="Mortgage Interest" value={d.mortgageInterest} step={500}
                onChange={v => set('mortgageInterest', v)} />
              <Field label="State & Local Taxes (SALT)" value={d.stateTaxesPaid} step={500}
                hint={`Capped at $${SALT_CAP.toLocaleString()} combined with property`}
                onChange={v => set('stateTaxesPaid', v)} />
              <Field label="Property Tax" value={d.propertyTax} step={200}
                hint="Included in SALT cap above"
                onChange={v => set('propertyTax', v)} />
              <Field label="Charitable Contributions" value={d.charitable} step={100}
                onChange={v => set('charitable', v)} />
              <Field label="Other Itemized" value={d.otherItemized} step={100}
                onChange={v => set('otherItemized', v)} />
              <div className="rc-derived-row">
                <span>SALT (capped)</span>
                <strong>({fmt(Math.min(d.stateTaxesPaid + d.propertyTax, SALT_CAP))})</strong>
              </div>
            </div>
          ) : (
            <p className="bp-subtitle" style={{ marginTop: 12 }}>
              {fmt(c.stdDed)} deduction applied automatically.
              {c.totalItemized > c.stdDed && ` Your itemized total (${fmt(c.totalItemized)}) exceeds standard — consider switching!`}
            </p>
          )}

          <div className="rc-derived-row" style={{ borderTop: '2px solid var(--primary)', color: 'var(--primary)' }}>
            <span style={{ fontWeight: 700 }}>Deduction Applied</span>
            <strong>({fmt(c.deduction)})</strong>
          </div>
          <div className="rc-derived-row">
            <span style={{ fontWeight: 700 }}>Ordinary Taxable Income</span>
            <strong>{fmt(c.ordinaryTaxable)}</strong>
          </div>
        </div>

        {/* ── Credits ── */}
        <div className="card rc-card">
          <h2>Tax Credits</h2>
          <p className="bp-subtitle">Directly reduce your tax bill dollar-for-dollar.</p>
          <div className="rc-fields">
            <Field label="Child Tax Credit" value={c.childTaxCredit} readOnly
              hint={`$2,000 × ${d.childrenUnder17} children (auto-calc)`} />
            <Field label="Child/Dependent Care Costs" value={d.childCareCosts} step={500}
              hint="20% credit on eligible expenses"
              onChange={v => set('childCareCosts', v)} />
            <Field label="Care Credit (auto-calc)" value={Math.round(c.careCredit)} readOnly />
            <Field label="Education Credit" value={d.educationCredit} step={100}
              hint="American Opportunity / Lifetime Learning"
              onChange={v => set('educationCredit', v)} />
            <Field label="Other Federal Credits" value={d.otherCredits} step={100}
              onChange={v => set('otherCredits', v)} />
          </div>
          <div className="rc-derived-row" style={{ borderTop: '2px solid #059669', color: '#059669' }}>
            <span style={{ fontWeight: 700 }}>Total Credits</span>
            <strong>({fmt(c.totalCredits)})</strong>
          </div>
        </div>

      </div>{/* end tax-mid-grid */}

      {/* ── State Tax ── */}
      <div className="card rc-card">
        <div className="tax-state-row">
          <div>
            <h2>State Income Tax</h2>
            <p className="bp-subtitle">Simplified flat-rate estimation.</p>
          </div>
          <label className="rc-sync-toggle">
            <input type="checkbox" checked={d.inclState} onChange={e => set('inclState', e.target.checked)} />
            Include state tax
          </label>
        </div>
        {d.inclState && (
          <div className="tax-setup-row" style={{ marginTop: 10 }}>
            <Field label="State Flat Rate" value={d.stateRate} step={0.25} prefix="" suffix="%" min={0}
              hint="Use your state's effective rate"
              onChange={v => set('stateRate', v)} />
            <Field label="Estimated State Tax" value={Math.round(c.stateTax)} readOnly hint="Applied to taxable income" />
          </div>
        )}
      </div>

      {/* ── Results ── */}
      <div className="tax-results-grid">

        {/* Waterfall */}
        <div className="card rc-card">
          <h2>Tax Calculation Waterfall</h2>
          <table className="wf-table">
            <tbody>
              <WaterfallRow label="W-2 Wages"              value={c.totalWages}        indent />
              {c.totalSENet > 0 && <WaterfallRow label="Self-Employment Income" value={c.totalSENet} indent />}
              {c.totalSTGains > 0 && <WaterfallRow label="Short-Term Gains"    value={c.totalSTGains} indent />}
              {c.totalLTGains > 0 && <WaterfallRow label="Long-Term Gains"     value={c.totalLTGains} indent />}
              {c.totalOther > 0 && <WaterfallRow label="Other Income"          value={c.totalOther}   indent />}
              <WaterfallRow label="Gross Income"           value={c.grossIncome}       bold border />
              <WaterfallRow label="Adjustments"            value={-c.totalAdjustments} color="#ef4444" indent />
              <WaterfallRow label="Adjusted Gross Income"  value={c.agi}               bold border color="#6366f1" />
              <WaterfallRow label="Deduction"              value={-c.deduction}        color="#ef4444" indent />
              <WaterfallRow label="Taxable Income"         value={c.ordinaryTaxable}   bold border />
              <WaterfallRow label="Ordinary Income Tax"    value={c.ordinaryTax}       color="#ef4444" indent />
              {c.ltcgTax > 0 && <WaterfallRow label="LTCG Tax"   value={c.ltcgTax}   color="#ef4444" indent />}
              {c.niitTax > 0 && <WaterfallRow label="NIIT (3.8%)" value={c.niitTax}  color="#ef4444" indent />}
              <WaterfallRow label="Credits"                value={-c.totalCredits}     color="#059669" indent />
              <WaterfallRow label="Federal Income Tax"     value={c.fedAfterCredits}   bold border color="#ef4444" />
              {c.totalSETax > 0 && <WaterfallRow label="Self-Employment Tax" value={c.totalSETax} color="#f97316" indent />}
              <WaterfallRow label="FICA (employee)"        value={c.totalFICA}         color="#f97316" indent />
              {d.inclState && <WaterfallRow label="State Income Tax" value={c.stateTax} color="#f97316" indent />}
              <WaterfallRow label="Total Tax Burden"       value={c.totalTaxBurden}    bold border color="#dc2626" />
              <WaterfallRow label="After-Tax Income"       value={c.afterTaxIncome}    bold color="#059669" />
            </tbody>
          </table>
        </div>

        {/* Summary panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Key rates */}
          <div className="card rc-card">
            <h2>Key Rates</h2>
            <div className="tax-rate-grid">
              <div className="tax-rate-box tax-rate-marginal">
                <span>Marginal Rate</span>
                <strong>{pct(c.marginalRate)}</strong>
              </div>
              <div className="tax-rate-box tax-rate-effective">
                <span>Effective Rate</span>
                <strong>{pct(c.effectiveRate)}</strong>
              </div>
              <div className="tax-rate-box tax-rate-fed">
                <span>Federal Tax</span>
                <strong>{fmt(c.totalFederal)}</strong>
              </div>
              <div className="tax-rate-box tax-rate-total">
                <span>Total Burden</span>
                <strong>{fmt(c.totalTaxBurden)}</strong>
              </div>
            </div>
          </div>

          {/* Pie chart */}
          <div className="card rc-card">
            <h2>Income Allocation</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" labelLine={false}
                  label={({ name, percent }) => percent > 0.06 ? `${(percent*100).toFixed(0)}%` : ''}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v) => [fmt(v), '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="tax-pie-legend">
              {pieData.map(d => (
                <div key={d.name} className="tax-pie-item">
                  <span className="rc-dot" style={{ background: d.color, borderRadius: 3 }} />
                  <span>{d.name}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Bracket Breakdown ── */}
      <div className="card rc-card">
        <h2>Federal Income Tax Bracket Breakdown</h2>
        <p className="bp-subtitle">Ordinary taxable income of {fmt(c.ordinaryTaxable)} — only the income within each bracket is taxed at that rate.</p>

        {/* Stacked bar */}
        <div className="tax-bracket-bar">
          {c.bkdown.filter(b => b.inBracket > 0).map((b, i) => (
            <div key={i} className="tax-bracket-segment"
              style={{ width: `${(b.inBracket / c.ordinaryTaxable) * 100}%`, background: b.color }}
              title={`${(b.rate * 100).toFixed(0)}%: ${fmt(b.inBracket)}`}
            />
          ))}
        </div>

        <table className="amort-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Rate</th>
              <th>Bracket Range</th>
              <th>Your Income in Bracket</th>
              <th>Tax</th>
              <th>Cumul. Tax</th>
            </tr>
          </thead>
          <tbody>
            {brackets.map((b, i) => {
              const inBracket = Math.max(0, Math.min(c.ordinaryTaxable, b.max) - b.min)
              if (inBracket === 0 && c.ordinaryTaxable <= b.min) return null
              const bracketTax = inBracket * b.rate
              const cumTax = calcOrdinaryTax(Math.min(c.ordinaryTaxable, b.max === Infinity ? c.ordinaryTaxable : b.max), brackets)
              const isMarginal = c.marginalRate === b.rate && inBracket > 0
              return (
                <tr key={i} style={{ background: isMarginal ? `${BRACKET_COLORS[i]}22` : '' }}>
                  <td style={{ textAlign: 'left', fontWeight: isMarginal ? 700 : 'normal' }}>
                    <span className="rc-scenario-dot" style={{ background: BRACKET_COLORS[i] }} />
                    {(b.rate * 100).toFixed(0)}%
                    {isMarginal && <span className="tax-marginal-badge">marginal</span>}
                  </td>
                  <td>{fmt(b.min)} – {b.max === Infinity ? '∞' : fmt(b.max)}</td>
                  <td style={{ color: inBracket > 0 ? BRACKET_COLORS[i] : 'var(--text-muted)', fontWeight: inBracket > 0 ? 600 : 'normal' }}>
                    {inBracket > 0 ? fmt(inBracket) : '—'}
                  </td>
                  <td style={{ color: inBracket > 0 ? '#ef4444' : 'var(--text-muted)' }}>
                    {inBracket > 0 ? fmt(bracketTax) : '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {inBracket > 0 ? fmt(cumTax) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
              <td style={{ textAlign: 'left' }} colSpan={2}>Total</td>
              <td>{fmt(c.ordinaryTaxable)}</td>
              <td style={{ color: '#ef4444' }}>{fmt(c.ordinaryTax)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Withholding & Quarterly Payments ── */}
      <div className="card rc-card">
        <h2>Withholding &amp; Quarterly Payments</h2>
        <div className="tax-mid-grid">
          <div>
            <div className="rc-fields">
              <Field label="Total W-2 Withholding" value={d.p1.withholding + d.p2.withholding} readOnly
                hint="Sum of box 2 on your W-2s" />
              <Field label="Estimated Tax Payments Made" value={d.qtrPaid} step={500}
                hint="Total quarterly payments this year"
                onChange={v => set('qtrPaid', v)} />
            </div>
            <div className="rc-derived-row">
              <span>Total Pre-Paid Tax</span>
              <strong>{fmt(c.totalPrepaid)}</strong>
            </div>
            <div className="rc-derived-row">
              <span>Federal + State Tax Owed</span>
              <strong>{fmt(c.totalFederal + c.stateTax)}</strong>
            </div>
            <div className={`rc-derived-row ${Math.abs(c.balanceDue) > 0 ? '' : ''}`}
              style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <span>{c.balanceDue > 0 ? 'Balance Due' : 'Estimated Refund'}</span>
              <strong style={{ color: c.balanceDue > 0 ? '#dc2626' : '#059669' }}>
                {c.balanceDue > 0 ? fmt(c.balanceDue) : fmt(-c.balanceDue)}
              </strong>
            </div>
          </div>

          {c.qtrPaymentNeeded > 0 && (
            <div>
              <h3 className="rc-scenario-subtitle">Quarterly Payment Schedule</h3>
              <p className="bp-subtitle">Self-employment income detected. Estimated payments to avoid underpayment penalty:</p>
              <table className="amort-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Quarter</th>
                    <th style={{ textAlign: 'left' }}>Due Date</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { q: 'Q1 (Jan–Mar)', due: 'Apr 15, 2025' },
                    { q: 'Q2 (Apr–May)', due: 'Jun 16, 2025' },
                    { q: 'Q3 (Jun–Aug)', due: 'Sep 15, 2025' },
                    { q: 'Q4 (Sep–Dec)', due: 'Jan 15, 2026' },
                  ].map(row => (
                    <tr key={row.q}>
                      <td style={{ textAlign: 'left' }}>{row.q}</td>
                      <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{row.due}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(c.qtrPaymentNeeded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
