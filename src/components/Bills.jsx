import { useState, useMemo } from 'react'
import { setAppData } from '../lib/db'

const BILLS_KEY  = 'finance_bills'
const FREQUENCIES = ['Monthly', 'Weekly', 'Bi-weekly', 'Quarterly', 'Annual']
const CATEGORIES  = ['Housing', 'Utilities', 'Entertainment', 'Insurance', 'Subscriptions', 'Transportation', 'Health', 'Other']

const CATEGORY_COLORS = {
  Housing:        '#6366f1',
  Utilities:      '#0ea5e9',
  Entertainment:  '#ec4899',
  Insurance:      '#f59e0b',
  Subscriptions:  '#8b5cf6',
  Transportation: '#10b981',
  Health:         '#ef4444',
  Other:          '#94a3b8',
}

const DEFAULT_BILLS = [
  { id: 'b01', name: 'Rent',           amount: 1350,  frequency: 'Monthly',  category: 'Housing',        dueDay: 1,  active: true },
  { id: 'b02', name: 'Electric',        amount: 94,    frequency: 'Monthly',  category: 'Utilities',      dueDay: 3,  active: true },
  { id: 'b03', name: 'Internet',        amount: 32,    frequency: 'Monthly',  category: 'Utilities',      dueDay: 6,  active: true },
  { id: 'b04', name: 'Netflix',         amount: 15.99, frequency: 'Monthly',  category: 'Entertainment',  dueDay: 1,  active: true },
  { id: 'b05', name: 'Spotify',         amount: 12.99, frequency: 'Monthly',  category: 'Entertainment',  dueDay: 1,  active: true },
  { id: 'b06', name: 'Gym Membership',  amount: 45,    frequency: 'Monthly',  category: 'Health',         dueDay: 1,  active: true },
  { id: 'b07', name: 'Car Insurance',   amount: 720,   frequency: 'Annual',   category: 'Insurance',      dueDay: 15, active: true },
  { id: 'b08', name: 'Transit Pass',    amount: 85,    frequency: 'Monthly',  category: 'Transportation', dueDay: 1,  active: true },
]

function load() {
  try {
    const s = localStorage.getItem(BILLS_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
    return DEFAULT_BILLS
  } catch { return DEFAULT_BILLS }
}

function persist(bills) {
  localStorage.setItem(BILLS_KEY, JSON.stringify(bills))
  setAppData('bills', bills).catch(console.error)
}

function toMonthly(amount, frequency) {
  switch (frequency) {
    case 'Weekly':    return amount * 52 / 12
    case 'Bi-weekly': return amount * 26 / 12
    case 'Monthly':   return amount
    case 'Quarterly': return amount / 3
    case 'Annual':    return amount / 12
    default:          return amount
  }
}

function nextDue(dueDay) {
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), dueDay)
  if (thisMonth >= today) return thisMonth
  return new Date(today.getFullYear(), today.getMonth() + 1, dueDay)
}

function fmtDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmt(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const BLANK = { name: '', amount: '', frequency: 'Monthly', category: 'Housing', dueDay: 1, active: true, endDate: '' }

function isExpired(bill) {
  if (!bill.endDate) return false
  return bill.endDate < new Date().toISOString().slice(0, 10)
}

export default function Bills() {
  const [bills,    setBills]    = useState(load)
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState(BLANK)

  function commit(next) {
    setBills(next)
    persist(next)
  }

  function openAdd() {
    setEditId(null)
    setForm(BLANK)
    setShowForm(true)
  }

  function openEdit(bill) {
    setEditId(bill.id)
    setForm({ ...bill })
    setShowForm(true)
  }

  function cancel() {
    setShowForm(false)
    setEditId(null)
    setForm(BLANK)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const bill = {
      ...form,
      amount: parseFloat(form.amount) || 0,
      dueDay: parseInt(form.dueDay)   || 1,
    }
    if (!bill.name.trim() || bill.amount <= 0) return
    if (editId) {
      commit(bills.map(b => b.id === editId ? { ...bill, id: editId } : b))
    } else {
      commit([...bills, { ...bill, id: crypto.randomUUID() }])
    }
    cancel()
  }

  function field(key, value) {
    setForm(p => ({ ...p, [key]: value }))
  }

  const grouped = useMemo(() => {
    const map = {}
    CATEGORIES.forEach(cat => { map[cat] = [] })
    bills.forEach(b => {
      if (map[b.category]) map[b.category].push(b)
      else map['Other'].push(b)
    })
    return CATEGORIES
      .filter(cat => map[cat].length > 0)
      .map(cat => ({ cat, items: map[cat] }))
  }, [bills])

  const totalMonthly = useMemo(() =>
    bills.filter(b => b.active && !isExpired(b)).reduce((s, b) => s + toMonthly(b.amount, b.frequency), 0),
    [bills]
  )

  const isAddMode = showForm && !editId

  return (
    <div className="rc-page">

      {/* ── Header card with inline form ────────────────────── */}
      <div className="card rc-card">
        <div className="rc-card-head">
          <h2>Bills &amp; Subscriptions</h2>
          <button
            className="bills-btn-primary"
            onClick={isAddMode ? cancel : openAdd}
          >
            {isAddMode ? '✕ Cancel' : '+ Add Bill'}
          </button>
        </div>

        {showForm && (
          <form className="bills-form" onSubmit={handleSubmit}>
            <div className="bills-form-grid">
              <div className="rc-field">
                <label className="rc-label">Name</label>
                <input
                  className="bills-text-input"
                  placeholder="e.g. Netflix"
                  value={form.name}
                  onChange={e => field('name', e.target.value)}
                  required
                />
              </div>

              <div className="rc-field">
                <label className="rc-label">Amount</label>
                <div className="nw-num-wrap">
                  <span className="nw-prefix">$</span>
                  <input
                    className="nw-num-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    style={{ width: '90px' }}
                    value={form.amount}
                    onChange={e => field('amount', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Frequency</label>
                <select
                  className="bills-select"
                  value={form.frequency}
                  onChange={e => field('frequency', e.target.value)}
                >
                  {FREQUENCIES.map(fr => <option key={fr}>{fr}</option>)}
                </select>
              </div>

              <div className="rc-field">
                <label className="rc-label">Category</label>
                <select
                  className="bills-select"
                  value={form.category}
                  onChange={e => field('category', e.target.value)}
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div className="rc-field">
                <label className="rc-label">Due Day</label>
                <select
                  className="bills-select"
                  value={form.dueDay}
                  onChange={e => field('dueDay', parseInt(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{ordinal(d)}</option>
                  ))}
                </select>
              </div>

              <div className="rc-field">
                <label className="rc-label">Status</label>
                <label className="bills-toggle">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => field('active', e.target.checked)}
                  />
                  <span className="bills-toggle-track">
                    <span className="bills-toggle-thumb" />
                  </span>
                  <span className="bills-toggle-label">{form.active ? 'Active' : 'Paused'}</span>
                </label>
              </div>

              <div className="rc-field">
                <label className="rc-label">End Date <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                <input
                  type="date"
                  className="bills-text-input"
                  value={form.endDate || ''}
                  onChange={e => field('endDate', e.target.value)}
                />
              </div>
            </div>

            <div className="bills-form-actions">
              <button type="submit" className="bills-btn-primary">
                {editId ? 'Save Changes' : 'Add Bill'}
              </button>
              <button type="button" className="bills-btn-ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Bills grouped by category ────────────────────────── */}
      {grouped.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>
          No bills yet — click &quot;+ Add Bill&quot; to get started.
        </div>
      ) : (
        grouped.map(({ cat, items }) => {
          const catMonthly = items
            .filter(b => b.active && !isExpired(b))
            .reduce((s, b) => s + toMonthly(b.amount, b.frequency), 0)

          return (
            <div key={cat} className="card rc-card">
              <div className="bills-cat-header">
                <span className="bills-cat-dot" style={{ background: CATEGORY_COLORS[cat] ?? '#94a3b8' }} />
                <span className="bills-cat-name">{cat}</span>
                <span className="bills-cat-total">{fmt(catMonthly)}<span className="bills-cat-total-unit">/mo</span></span>
              </div>

              <div className="bills-list">
                {items.map(bill => {
                  const monthly = toMonthly(bill.amount, bill.frequency)
                  const due     = nextDue(bill.dueDay)

                  const expired = isExpired(bill)
                  return (
                    <div key={bill.id} className={`bills-row${bill.active && !expired ? '' : ' bills-row-paused'}`}>
                      <div className="bills-row-info">
                        <span className="bills-row-name">{bill.name}
                          {expired && <span className="bills-expired-badge">Expired</span>}
                        </span>
                        <span className="bills-row-meta">
                          {bill.frequency} &middot; Due {ordinal(bill.dueDay)}
                          {!expired && ` · Next ${fmtDate(due)}`}
                          {bill.endDate && !expired && ` · Ends ${bill.endDate}`}
                        </span>
                      </div>

                      <div className="bills-row-amounts">
                        <span className="bills-row-amount">{fmt(bill.amount)}</span>
                        {bill.frequency !== 'Monthly' && (
                          <span className="bills-row-monthly">{fmt(monthly)}/mo</span>
                        )}
                      </div>

                      <div className="bills-row-actions">
                        <button
                          className={`bills-status-btn ${bill.active ? 'bills-status-active' : 'bills-status-paused'}`}
                          onClick={() => commit(bills.map(b => b.id === bill.id ? { ...b, active: !b.active } : b))}
                          title={bill.active ? 'Click to pause' : 'Click to activate'}
                        >
                          {bill.active ? 'Active' : 'Paused'}
                        </button>
                        <button
                          className="nw-delete"
                          onClick={() => openEdit(bill)}
                          title="Edit"
                        >✎</button>
                        <button
                          className="nw-delete"
                          onClick={() => commit(bills.filter(b => b.id !== bill.id))}
                          title="Delete"
                        >✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      {/* ── Total bar ───────────────────────────────────────── */}
      {bills.length > 0 && (
        <div className="bills-total-bar">
          <span className="bills-total-label">Total Monthly Cost</span>
          <div className="bills-total-right">
            <span className="bills-total-amount">{fmt(totalMonthly)}</span>
            <span className="bills-total-annual">{fmt(totalMonthly * 12)}/yr</span>
          </div>
        </div>
      )}
    </div>
  )
}
