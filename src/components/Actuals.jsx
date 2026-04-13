import { useState, useEffect, useMemo } from 'react'

const INCOME_CATS  = ['Salary','Bonus','Freelance','Investment','Business','Gift','Other']
const EXPENSE_CATS = ['Housing & Utilities','Food & Dining','Transportation','Entertainment','Health & Fitness','Shopping','Education','Travel','Personal Care','Other']
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getPastMonths(count = 24) {
  const now = new Date()
  const out = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      year:  d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }
  return out
}

function newRow(category = '', amount = '') {
  return { id: crypto.randomUUID(), category, amount: amount === '' ? '' : String(amount) }
}

function fmt(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function RowEditor({ rows, setRows, categories, defaultCat, label }) {
  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  function removeRow(id) {
    setRows(prev => prev.filter(r => r.id !== id))
  }
  function addRow() {
    setRows(prev => [...prev, newRow(defaultCat)])
  }

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  return (
    <div className="actuals-section">
      <div className="actuals-section-header">
        <span className="actuals-section-label">{label}</span>
        <span className="actuals-section-total">{fmt(total)}</span>
      </div>

      <div className="actuals-rows">
        {rows.map(row => (
          <div key={row.id} className="actuals-row">
            <select
              className="actuals-cat-select"
              value={row.category}
              onChange={e => updateRow(row.id, 'category', e.target.value)}
            >
              {row.category && !categories.includes(row.category) && (
                <option value={row.category}>{row.category}</option>
              )}
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="actuals-amount-wrap">
              <span className="actuals-dollar">$</span>
              <input
                className="actuals-amount-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={row.amount}
                onChange={e => updateRow(row.id, 'amount', e.target.value)}
              />
            </div>
            <button className="actuals-remove-btn" onClick={() => removeRow(row.id)} title="Remove row">×</button>
          </div>
        ))}
      </div>

      <button className="actuals-add-row-btn" onClick={addRow}>+ Add row</button>
    </div>
  )
}

export default function Actuals({ transactions, onSaveMonth }) {
  const months = useMemo(() => getPastMonths(24), [])

  const [selectedKey, setSelectedKey] = useState(months[0].key)
  const [incomeRows,  setIncomeRows]  = useState([newRow('Salary')])
  const [expenseRows, setExpenseRows] = useState([newRow('Housing & Utilities')])
  const [saving,      setSaving]      = useState(false)
  const [savedKey,    setSavedKey]    = useState(null)

  // Populate rows from existing transactions when month changes
  useEffect(() => {
    const monthTxs = transactions.filter(tx => tx.date.slice(0, 7) === selectedKey)

    const incByCat  = {}
    const expByCat  = {}
    monthTxs.forEach(tx => {
      if (tx.type === 'income')  incByCat[tx.category]  = (incByCat[tx.category]  || 0) + tx.amount
      if (tx.type === 'expense') expByCat[tx.category]  = (expByCat[tx.category]  || 0) + tx.amount
    })

    const iRows = Object.entries(incByCat).map(([cat, amt]) => newRow(cat, +amt.toFixed(2)))
    const eRows = Object.entries(expByCat).map(([cat, amt]) => newRow(cat, +amt.toFixed(2)))

    setIncomeRows(iRows.length  > 0 ? iRows : [newRow('Salary')])
    setExpenseRows(eRows.length > 0 ? eRows : [newRow('Housing & Utilities')])
    setSavedKey(null)
  }, [selectedKey, transactions])

  async function handleSave() {
    setSaving(true)
    try {
      await onSaveMonth(selectedKey, incomeRows, expenseRows)
      setSavedKey(selectedKey)
    } finally {
      setSaving(false)
    }
  }

  const totalIncome   = incomeRows.reduce((s, r)  => s + (parseFloat(r.amount)  || 0), 0)
  const totalExpenses = expenseRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const net           = totalIncome - totalExpenses

  const selectedMonth = months.find(m => m.key === selectedKey)
  const monthLabel    = selectedMonth
    ? `${MONTH_NAMES[selectedMonth.month - 1]} ${selectedMonth.year}`
    : ''

  // How many transactions already exist for this month
  const existingCount = transactions.filter(tx => tx.date.slice(0, 7) === selectedKey).length

  return (
    <div className="actuals-layout">

      {/* ── Left: month list ── */}
      <aside className="actuals-sidebar">
        <h3 className="actuals-sidebar-title">Month</h3>
        <ul className="actuals-month-list">
          {months.map(m => {
            const hasTx = transactions.some(tx => tx.date.slice(0, 7) === m.key)
            return (
              <li key={m.key}>
                <button
                  className={`actuals-month-btn${selectedKey === m.key ? ' active' : ''}${hasTx ? ' has-data' : ''}`}
                  onClick={() => setSelectedKey(m.key)}
                >
                  <span className="actuals-month-name">{MONTH_NAMES[m.month - 1]}</span>
                  <span className="actuals-month-year">{m.year}</span>
                  {hasTx && <span className="actuals-dot" />}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* ── Right: editor ── */}
      <div className="actuals-editor">
        <div className="actuals-editor-header">
          <h2 className="actuals-editor-title">{monthLabel}</h2>
          {existingCount > 0 && savedKey !== selectedKey && (
            <span className="actuals-overwrite-note">
              Saving will replace {existingCount} existing transaction{existingCount !== 1 ? 's' : ''} for this month.
            </span>
          )}
        </div>

        <div className="actuals-columns">
          <RowEditor
            rows={incomeRows}
            setRows={setIncomeRows}
            categories={INCOME_CATS}
            defaultCat="Salary"
            label="Income"
          />
          <RowEditor
            rows={expenseRows}
            setRows={setExpenseRows}
            categories={EXPENSE_CATS}
            defaultCat="Housing & Utilities"
            label="Expenses"
          />
        </div>

        {/* ── Summary bar ── */}
        <div className="actuals-summary">
          <div className="actuals-summary-item">
            <span className="actuals-summary-label">Total Income</span>
            <span className="actuals-summary-value income">{fmt(totalIncome)}</span>
          </div>
          <div className="actuals-summary-item">
            <span className="actuals-summary-label">Total Expenses</span>
            <span className="actuals-summary-value expense">{fmt(totalExpenses)}</span>
          </div>
          <div className="actuals-summary-item">
            <span className="actuals-summary-label">Net</span>
            <span className={`actuals-summary-value ${net >= 0 ? 'income' : 'expense'}`}>{fmt(net)}</span>
          </div>
          <button
            className="actuals-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : savedKey === selectedKey ? '✓ Saved' : `Save ${monthLabel}`}
          </button>
        </div>
      </div>

    </div>
  )
}
