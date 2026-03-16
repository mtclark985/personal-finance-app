import { useState, useMemo } from 'react'
import { setAppData } from '../lib/db'

const GOALS_KEY = 'finance_savings_goals'

const GOAL_TYPES = ['Vacation', 'Home', 'Car', 'Education', 'Emergency', 'Retirement', 'Other']

const TYPE_META = {
  Vacation:   { emoji: '🏖️', color: '#0ea5e9' },
  Home:       { emoji: '🏠', color: '#6366f1' },
  Car:        { emoji: '🚗', color: '#f59e0b' },
  Education:  { emoji: '🎓', color: '#8b5cf6' },
  Emergency:  { emoji: '🛡️', color: '#ef4444' },
  Retirement: { emoji: '🌅', color: '#10b981' },
  Other:      { emoji: '⭐', color: '#94a3b8' },
}

const DEFAULT_GOALS = [
  { id: 'g01', name: 'Emergency Fund',  type: 'Emergency',  targetAmount: 10000, savedAmount: 5200, targetDate: '' },
  { id: 'g02', name: 'Summer Vacation', type: 'Vacation',   targetAmount: 3000,  savedAmount: 900,  targetDate: '2026-08-01' },
  { id: 'g03', name: 'New Laptop',      type: 'Other',      targetAmount: 1500,  savedAmount: 450,  targetDate: '2026-06-01' },
]

const BLANK = { name: '', type: 'Vacation', targetAmount: '', savedAmount: '', targetDate: '' }

function load() {
  try {
    const s = localStorage.getItem(GOALS_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
    return DEFAULT_GOALS
  } catch { return DEFAULT_GOALS }
}

function persist(goals) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals))
  setAppData('savings_goals', goals).catch(console.error)
}

function fmt(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFull(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Whole months remaining from today to targetDate
function monthsLeft(targetDate) {
  if (!targetDate) return null
  const now    = new Date()
  const target = new Date(targetDate)
  const months = (target.getFullYear() - now.getFullYear()) * 12
               + (target.getMonth() - now.getMonth())
  return Math.max(0, months)
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function SavingsGoals() {
  const [goals,    setGoals]    = useState(load)
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState(BLANK)

  function commit(next) {
    setGoals(next)
    persist(next)
  }

  function field(key, val) {
    setForm(p => ({ ...p, [key]: val }))
  }

  function openAdd() {
    setEditId(null)
    setForm(BLANK)
    setShowForm(true)
  }

  function openEdit(goal) {
    setEditId(goal.id)
    setForm({ ...goal })
    setShowForm(true)
  }

  function cancel() {
    setShowForm(false)
    setEditId(null)
    setForm(BLANK)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const goal = {
      ...form,
      targetAmount: parseFloat(form.targetAmount) || 0,
      savedAmount:  parseFloat(form.savedAmount)  || 0,
    }
    if (!goal.name.trim() || goal.targetAmount <= 0) return
    if (editId) {
      commit(goals.map(g => g.id === editId ? { ...goal, id: editId } : g))
    } else {
      commit([...goals, { ...goal, id: crypto.randomUUID() }])
    }
    cancel()
  }

  // Summary totals
  const summary = useMemo(() => {
    const totalSaved  = goals.reduce((s, g) => s + (g.savedAmount  || 0), 0)
    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount || 0), 0)
    const pct = totalTarget > 0 ? Math.min(1, totalSaved / totalTarget) : 0
    return { totalSaved, totalTarget, pct }
  }, [goals])

  const isAddMode = showForm && !editId

  return (
    <div className="rc-page">

      {/* ── Summary strip ─────────────────────────────────── */}
      {goals.length > 0 && (
        <div className="card sg-summary-card">
          <div className="sg-summary-stats">
            <div className="sg-summary-stat">
              <span className="sg-summary-label">Total Saved</span>
              <strong className="sg-summary-val sg-val-income">{fmt(summary.totalSaved)}</strong>
            </div>
            <div className="sg-summary-divider" />
            <div className="sg-summary-stat">
              <span className="sg-summary-label">Total Target</span>
              <strong className="sg-summary-val">{fmt(summary.totalTarget)}</strong>
            </div>
            <div className="sg-summary-divider" />
            <div className="sg-summary-stat">
              <span className="sg-summary-label">Still Needed</span>
              <strong className="sg-summary-val sg-val-muted">{fmt(Math.max(0, summary.totalTarget - summary.totalSaved))}</strong>
            </div>
            <div className="sg-summary-divider" />
            <div className="sg-summary-stat">
              <span className="sg-summary-label">Overall</span>
              <strong className="sg-summary-val sg-val-primary">{Math.round(summary.pct * 100)}%</strong>
            </div>
          </div>
          <div className="sg-overall-bar-track">
            <div
              className="sg-overall-bar-fill"
              style={{ width: `${Math.round(summary.pct * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Header card with inline add/edit form ─────────── */}
      <div className="card rc-card">
        <div className="rc-card-head">
          <h2>Savings Goals</h2>
          <button
            className="bills-btn-primary"
            onClick={isAddMode ? cancel : openAdd}
          >
            {isAddMode ? '✕ Cancel' : '+ Add Goal'}
          </button>
        </div>

        {showForm && (
          <form className="bills-form" onSubmit={handleSubmit}>
            <div className="sg-form-grid">

              <div className="rc-field sg-field-name">
                <label className="rc-label">Goal Name</label>
                <input
                  className="bills-text-input"
                  placeholder="e.g. Vacation, New Car…"
                  value={form.name}
                  onChange={e => field('name', e.target.value)}
                  required
                />
              </div>

              <div className="rc-field">
                <label className="rc-label">Type</label>
                <select
                  className="bills-select"
                  value={form.type}
                  onChange={e => field('type', e.target.value)}
                >
                  {GOAL_TYPES.map(t => (
                    <option key={t} value={t}>
                      {TYPE_META[t].emoji} {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rc-field">
                <label className="rc-label">Target Amount</label>
                <div className="nw-num-wrap">
                  <span className="nw-prefix">$</span>
                  <input
                    className="nw-num-input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    style={{ width: '100px' }}
                    value={form.targetAmount}
                    onChange={e => field('targetAmount', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Currently Saved</label>
                <div className="nw-num-wrap">
                  <span className="nw-prefix">$</span>
                  <input
                    className="nw-num-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    style={{ width: '100px' }}
                    value={form.savedAmount}
                    onChange={e => field('savedAmount', e.target.value)}
                  />
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">Target Date <span className="rc-hint" style={{ display: 'inline' }}>(optional)</span></label>
                <input
                  className="bills-text-input sg-date-input"
                  type="date"
                  value={form.targetDate}
                  onChange={e => field('targetDate', e.target.value)}
                />
              </div>

            </div>

            <div className="bills-form-actions">
              <button type="submit" className="bills-btn-primary">
                {editId ? 'Save Changes' : 'Add Goal'}
              </button>
              <button type="button" className="bills-btn-ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Goal cards ────────────────────────────────────── */}
      {goals.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>
          No goals yet — click &quot;+ Add Goal&quot; to get started.
        </div>
      ) : (
        <div className="sg-grid">
          {goals.map(goal => {
            const meta    = TYPE_META[goal.type] ?? TYPE_META.Other
            const pct     = goal.targetAmount > 0
              ? Math.min(1, (goal.savedAmount || 0) / goal.targetAmount)
              : 0
            const needed  = Math.max(0, goal.targetAmount - (goal.savedAmount || 0))
            const months  = monthsLeft(goal.targetDate)
            const perMonth = months > 0 ? needed / months : null

            // Progress bar color: green when done, type color otherwise
            const barColor = pct >= 1 ? '#10b981' : meta.color

            return (
              <div key={goal.id} className="card sg-goal-card">

                {/* Card header */}
                <div className="sg-goal-header">
                  <div className="sg-goal-icon" style={{ background: `${meta.color}18`, color: meta.color }}>
                    {meta.emoji}
                  </div>
                  <div className="sg-goal-title-group">
                    <span className="sg-goal-name">{goal.name}</span>
                    <span className="sg-goal-type" style={{ color: meta.color }}>{goal.type}</span>
                  </div>
                  <div className="sg-goal-btns">
                    <button className="nw-delete" onClick={() => openEdit(goal)} title="Edit">✎</button>
                    <button className="nw-delete" onClick={() => commit(goals.filter(g => g.id !== goal.id))} title="Delete">✕</button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="sg-bar-wrap">
                  <div className="sg-bar-track">
                    <div
                      className="sg-bar-fill"
                      style={{ width: `${Math.round(pct * 100)}%`, background: barColor }}
                    />
                  </div>
                  <span className="sg-bar-pct" style={{ color: barColor }}>
                    {Math.round(pct * 100)}%
                  </span>
                </div>

                {/* Amounts row */}
                <div className="sg-amounts-row">
                  <div className="sg-amount-block">
                    <span className="sg-amount-label">Saved</span>
                    <strong className="sg-amount-val" style={{ color: '#10b981' }}>
                      {fmt(goal.savedAmount || 0)}
                    </strong>
                  </div>
                  <div className="sg-amount-block sg-amount-center">
                    <span className="sg-amount-label">Target</span>
                    <strong className="sg-amount-val">{fmt(goal.targetAmount)}</strong>
                  </div>
                  <div className="sg-amount-block sg-amount-right">
                    <span className="sg-amount-label">Needed</span>
                    <strong className="sg-amount-val" style={{ color: needed > 0 ? 'var(--text)' : '#10b981' }}>
                      {needed > 0 ? fmt(needed) : '✓ Done'}
                    </strong>
                  </div>
                </div>

                {/* Target date & monthly required */}
                {goal.targetDate && (
                  <div className="sg-deadline-row">
                    {months !== null && months > 0 ? (
                      <>
                        <div className="sg-deadline-chip">
                          <span className="sg-deadline-months">{months}</span>
                          <span className="sg-deadline-unit">mo left</span>
                        </div>
                        {perMonth !== null && (
                          <span className="sg-deadline-per-month">
                            {fmtFull(perMonth)}<span className="sg-deadline-slash">/mo to hit goal</span>
                          </span>
                        )}
                      </>
                    ) : months === 0 ? (
                      <span className="sg-deadline-past">Target date reached</span>
                    ) : null}
                    <span className="sg-deadline-date">by {fmtDate(goal.targetDate)}</span>
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
