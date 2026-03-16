import { useState } from 'react'

const EXPENSE_CATEGORIES = [
  'Food & Dining','Housing & Utilities','Transportation','Entertainment',
  'Health & Fitness','Shopping','Education','Travel','Personal Care','Other',
]
const INCOME_CATEGORIES = [
  'Salary','Freelance','Investment','Business','Gift','Other',
]
const FREQUENCIES = ['Monthly', 'Weekly', 'Bi-weekly', 'Quarterly', 'Annual']

function today() { return new Date().toISOString().slice(0, 10) }

export default function TransactionForm({ onAdd, household }) {
  const [type,        setType]        = useState('expense')
  const [amount,      setAmount]      = useState('')
  const [category,    setCategory]    = useState(EXPENSE_CATEGORIES[0])
  const [date,        setDate]        = useState(today())
  const [description, setDescription] = useState('')
  const [earner,      setEarner]      = useState('joint')
  const [error,       setError]       = useState('')
  const [recurring,   setRecurring]   = useState(false)
  const [frequency,   setFrequency]   = useState('Monthly')
  const [endDate,     setEndDate]     = useState('')

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const p1 = household?.p1 || 'Person 1'
  const p2 = household?.p2 || 'Person 2'

  function handleTypeChange(t) {
    setType(t)
    setCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0])
    if (t === 'income') { setRecurring(false); setEndDate('') }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const parsed = parseFloat(amount)
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setError('Please enter a valid amount greater than 0.')
      return
    }
    if (!date) { setError('Please select a date.'); return }
    setError('')
    const tx = {
      type, amount: parsed, category, date,
      description: description.trim(), earner,
      recurring: type === 'expense' && recurring,
      frequency: type === 'expense' && recurring ? frequency : null,
      endDate:   type === 'expense' && recurring && endDate ? endDate : null,
    }
    onAdd(tx)
    setAmount('')
    setDescription('')
    setDate(today())
    setRecurring(false)
    setFrequency('Monthly')
    setEndDate('')
  }

  return (
    <div className="card form-card">
      <h2>Add Transaction</h2>

      <div className="type-toggle">
        <button type="button"
          className={type === 'expense' ? 'active expense' : ''}
          onClick={() => handleTypeChange('expense')}>Expense</button>
        <button type="button"
          className={type === 'income' ? 'active income' : ''}
          onClick={() => handleTypeChange('income')}>Income</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="amount">Amount ($)</label>
          <input id="amount" type="number" min="0.01" step="0.01" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="category">Category</label>
          <select id="category" value={category} onChange={e => setCategory(e.target.value)}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Earner</label>
          <div className="earner-radio-group">
            {[
              { value: 'joint', label: 'Joint / Combined' },
              { value: 'p1',    label: p1 },
              { value: 'p2',    label: p2 },
            ].map(opt => (
              <label key={opt.value} className={`earner-radio ${earner === opt.value ? 'checked' : ''} ${opt.value}`}>
                <input type="radio" name="earner" value={opt.value}
                  checked={earner === opt.value} onChange={() => setEarner(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date}
            onChange={e => setDate(e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="description">Description (optional)</label>
          <input id="description" type="text" placeholder="e.g. Grocery run"
            value={description} onChange={e => setDescription(e.target.value)} maxLength={100} />
        </div>

        {type === 'expense' && (
          <div className="form-group">
            <label className="tf-recurring-label">
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
              Recurring expense
            </label>
            {recurring && (
              <div className="tf-recurring-fields">
                <div>
                  <label className="tf-sub-label">Frequency</label>
                  <select value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="tf-sub-label">End Date (optional)</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className={`submit-btn ${type}`}>
          Add {type === 'expense' ? 'Expense' : 'Income'}
        </button>
      </form>
    </div>
  )
}
