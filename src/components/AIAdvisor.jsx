import { useState, useEffect, useRef, useMemo } from 'react'
import { getAppData, setAppData } from '../lib/db'

// ── Storage keys ──────────────────────────────────────────────────────────────
const HISTORY_KEY = 'ai_advisor_history'
const BUDGET_KEY  = 'finance_budget'
const NW_KEY      = 'finance_networth'
const LOANS_KEY   = 'finance_loans'
const BILLS_KEY   = 'finance_bills'
const GOALS_KEY   = 'finance_savings_goals'
const ESPP_KEY    = 'espp_data'
const LTCF_KEY    = 'longterm_cashflow_settings'

const AVG_WORK_DAYS = 260 / 12

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Suggested questions pool ─────────────────────────────────────────────────
const QUESTION_POOL = [
  'How is my spending this month compared to my budget?',
  'Am I on track for my savings goals?',
  'What should I focus on to improve my financial health?',
  'How much could I save by reducing my dining out spending?',
  'When will I reach my emergency fund goal at this pace?',
  'Is my net worth growing at a healthy rate?',
  'What is my biggest spending category and is it reasonable?',
  'How is my ESPP performing?',
  'Am I saving enough for retirement?',
  'How long would my savings last if I lost my income?',
  'What is my current savings rate?',
  'How can I pay down my debt faster?',
  'What is the best use of my bonus this year?',
  'How can I optimize my monthly cash flow?',
  'What financial goal should I prioritize right now?',
  'Are my bills and subscriptions reasonable for my income?',
]

function pickSuggestions() {
  return [...QUESTION_POOL].sort(() => Math.random() - 0.5).slice(0, 4)
}

// ── Module-scope helpers ─────────────────────────────────────────────────────

function readLocal(key) {
  try {
    const s = localStorage.getItem(key)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function billToMonthly(amount, frequency) {
  switch (frequency) {
    case 'Weekly':    return amount * 52 / 12
    case 'Bi-weekly': return amount * 26 / 12
    case 'Monthly':   return amount
    case 'Quarterly': return amount / 3
    case 'Annual':    return amount / 12
    default:          return amount
  }
}

function earnerTakeHome(e) {
  if (!e) return 0
  if ('baseSalary' in e) {
    const gross   = (e.baseSalary || 0) / 260 * AVG_WORK_DAYS
      + (e.bonusTarget  || 0) / 12
      + (e.equityTarget || 0) / 12
    const preTax  = (e.retirement401k || 0) + (e.healthInsurance || 0)
      + (e.hsa || 0) + (e.otherPreTax || 0)
    const taxable = Math.max(0, gross - preTax)
    const fed   = taxable * (e.federalTaxRate || 0) / 100
    const state = taxable * (e.stateTaxRate   || 0) / 100
    const fica  = gross * 0.0765
    return gross - fed - state - fica - preTax - (e.otherPostTax || 0)
  }
  return (e.grossIncome || 0) - (e.taxes || 0) - (e.retirementSavings || 0) - (e.otherSavings || 0)
}

// ── Financial context builder ────────────────────────────────────────────────
function buildFinancialContext(transactions) {
  const lines = []

  // Current month
  const now       = new Date()
  const currYear  = now.getFullYear()
  const currMonth = now.getMonth() + 1
  const currKey   = `${currYear}-${String(currMonth).padStart(2, '0')}`
  const currTxs   = transactions.filter(tx => tx.date.startsWith(currKey))
  const currInc   = currTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const currExp   = currTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  lines.push(`## CURRENT MONTH: ${MONTH_NAMES[currMonth - 1]} ${currYear}`)
  lines.push(`- Income: ${fmtMoney(currInc)}`)
  lines.push(`- Expenses: ${fmtMoney(currExp)}`)
  lines.push(`- Net: ${currInc - currExp >= 0 ? '+' : ''}${fmtMoney(currInc - currExp)}`)
  lines.push('')

  // Last 3 months — build per-month summary and category rollup
  const monthMap = {}
  transactions.forEach(tx => {
    const key = tx.date.slice(0, 7)
    if (!monthMap[key]) monthMap[key] = { income: 0, expenses: 0, cats: {} }
    if (tx.type === 'income')  monthMap[key].income   += tx.amount
    if (tx.type === 'expense') {
      monthMap[key].expenses += tx.amount
      monthMap[key].cats[tx.category] = (monthMap[key].cats[tx.category] || 0) + tx.amount
    }
  })

  const last3 = Object.entries(monthMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)

  if (last3.length > 0) {
    const avgInc = last3.reduce((s, [, v]) => s + v.income,   0) / last3.length
    const avgExp = last3.reduce((s, [, v]) => s + v.expenses, 0) / last3.length
    lines.push(`## LAST ${last3.length} MONTHS AVERAGE`)
    lines.push(`- Avg Monthly Income: ${fmtMoney(avgInc)}`)
    lines.push(`- Avg Monthly Expenses: ${fmtMoney(avgExp)}`)
    lines.push(`- Avg Net: ${avgInc - avgExp >= 0 ? '+' : ''}${fmtMoney(avgInc - avgExp)}`)
    if (avgInc > 0) {
      lines.push(`- Savings Rate: ${((avgInc - avgExp) / avgInc * 100).toFixed(1)}%`)
    }
    lines.push('')

    const catTotals = {}
    last3.forEach(([, v]) => {
      Object.entries(v.cats).forEach(([cat, amt]) => {
        catTotals[cat] = (catTotals[cat] || 0) + amt
      })
    })
    const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (topCats.length > 0) {
      lines.push(`## TOP EXPENSE CATEGORIES (last ${last3.length} months combined)`)
      topCats.forEach(([cat, total]) => {
        lines.push(`- ${cat}: ${fmtMoney(total)} total (${fmtMoney(total / last3.length)}/mo avg)`)
      })
      lines.push('')
    }
  }

  // Budget planner
  const budget = readLocal(BUDGET_KEY)
  if (budget) {
    const th1    = earnerTakeHome(budget.earner1 ?? budget.income)
    const th2    = earnerTakeHome(budget.earner2 ?? {})
    const fixed  = (budget.fixedExpenses || []).reduce((s, r) => s + (r.amount || 0), 0)
    const disc   = (budget.discretionary  || []).reduce((s, r) => s + (r.amount || 0), 0)
    const totalTH = th1 + th2
    lines.push(`## BUDGET PLANNER`)
    lines.push(`- Combined Monthly Take-Home: ${fmtMoney(totalTH)}`)
    if ((budget.earner1?.baseSalary || 0) > 0) {
      lines.push(`  - Earner 1: ${fmtMoney(th1)}/mo take-home (${fmtMoney((budget.earner1.baseSalary || 0) / 12)}/mo gross)`)
    }
    if ((budget.earner2?.baseSalary || 0) > 0) {
      lines.push(`  - Earner 2: ${fmtMoney(th2)}/mo take-home (${fmtMoney((budget.earner2.baseSalary || 0) / 12)}/mo gross)`)
    }
    lines.push(`- Fixed Expenses: ${fmtMoney(fixed)}/mo`)
    ;(budget.fixedExpenses || []).forEach(r => lines.push(`  - ${r.label}: ${fmtMoney(r.amount)}`))
    lines.push(`- Discretionary: ${fmtMoney(disc)}/mo`)
    ;(budget.discretionary || []).forEach(r => lines.push(`  - ${r.label}: ${fmtMoney(r.amount)}`))
    lines.push(`- Budget Surplus: ${fmtMoney(totalTH - fixed - disc)}/mo after all budgeted expenses`)
    lines.push('')
  }

  // Net worth
  const accounts = readLocal(NW_KEY) || []
  const loans    = readLocal(LOANS_KEY) || []
  if (accounts.length > 0) {
    const totalAssets = accounts.reduce((s, a) => s + (a.balance || 0), 0)
    const totalLiab   = loans.reduce((s, l) => s + (l.balance || 0), 0)
    lines.push(`## NET WORTH`)
    lines.push(`- Total Assets: ${fmtMoney(totalAssets)}`)
    lines.push(`- Total Liabilities: ${fmtMoney(totalLiab)}`)
    lines.push(`- Net Worth: ${fmtMoney(totalAssets - totalLiab)}`)
    accounts.forEach(a => lines.push(`  - ${a.name} (${a.category}): ${fmtMoney(a.balance)}, ${a.growthRate}%/yr growth`))
    if (loans.length > 0) {
      lines.push(`Liabilities:`)
      loans.forEach(l => lines.push(`  - ${l.name}: ${fmtMoney(l.balance)} @ ${l.annualRate}% APR, ${l.termMonths} months remaining`))
    }
    lines.push('')
  }

  // Savings goals
  const goals = readLocal(GOALS_KEY) || []
  if (goals.length > 0) {
    lines.push(`## SAVINGS GOALS`)
    goals.forEach(g => {
      const pct       = g.targetAmount > 0 ? ((g.savedAmount || 0) / g.targetAmount * 100).toFixed(0) : 0
      const remaining = (g.targetAmount || 0) - (g.savedAmount || 0)
      let extra = ''
      if (g.targetDate) {
        const t      = new Date(g.targetDate)
        const months = Math.max(0, (t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth()))
        const perMo  = months > 0 ? remaining / months : remaining
        extra = ` | due ${g.targetDate} (${months} mo left, need ${fmtMoney(perMo)}/mo to reach goal)`
      }
      lines.push(`- ${g.name} (${g.type}): ${fmtMoney(g.savedAmount || 0)} saved / ${fmtMoney(g.targetAmount || 0)} target (${pct}% done, ${fmtMoney(remaining)} to go)${extra}`)
    })
    lines.push('')
  }

  // Bills & subscriptions
  const bills = readLocal(BILLS_KEY) || []
  if (bills.length > 0) {
    const active   = bills.filter(b => b.active)
    const totalMo  = active.reduce((s, b) => s + billToMonthly(b.amount, b.frequency), 0)
    lines.push(`## BILLS & SUBSCRIPTIONS`)
    lines.push(`- ${active.length} active (${bills.length - active.length} paused), total ${fmtMoney(totalMo)}/mo (${fmtMoney(totalMo * 12)}/yr)`)
    active.forEach(b => lines.push(`  - ${b.name} (${b.category}): ${fmtMoney(billToMonthly(b.amount, b.frequency))}/mo`))
    lines.push('')
  }

  // ESPP
  const espp = readLocal(ESPP_KEY)
  if (espp?.plan) {
    const plan = espp.plan
    const annualContrib = Math.min(
      (plan.salary || 0) * ((plan.contributionPct || 0) / 100),
      plan.maxContribution || 25000,
      25000,
    )
    lines.push(`## ESPP (Employee Stock Purchase Plan)`)
    if (plan.companyName) lines.push(`- Company: ${plan.companyName}${plan.ticker ? ' (' + plan.ticker.toUpperCase() + ')' : ''}`)
    lines.push(`- Discount: ${plan.discount}%${plan.lookback ? ' with lookback provision' : ''}`)
    lines.push(`- Contribution: ${plan.contributionPct}% of ${fmtMoney(plan.salary || 0)} salary = ${fmtMoney(annualContrib / 12)}/mo (${fmtMoney(annualContrib)}/yr)`)
    if (plan.offeringStart && plan.offeringEnd) {
      lines.push(`- Offering period: ${plan.offeringStart} → ${plan.offeringEnd}`)
    }
    const curPrice = parseFloat(espp.currentPrice) || 0
    if (espp.purchases?.length > 0 && curPrice > 0) {
      let totalVal = 0, totalCost = 0
      espp.purchases.forEach(lot => {
        const base   = plan.lookback
          ? Math.min(lot.fmvStart || 0, lot.fmvPurchase || 0)
          : (lot.fmvPurchase || 0)
        const pp     = base * (1 - (plan.discount || 0) / 100)
        const shares = pp > 0 ? (lot.totalContributions || 0) / pp : 0
        totalVal  += shares * curPrice
        totalCost += lot.totalContributions || 0
      })
      lines.push(`- Holdings: ${espp.purchases.length} lot(s), current value ${fmtMoney(totalVal)}, cost basis ${fmtMoney(totalCost)}, unrealized ${totalVal - totalCost >= 0 ? '+' : ''}${fmtMoney(totalVal - totalCost)}`)
    }
    lines.push('')
  }

  // Long-term cash flow
  const ltcf = readLocal(LTCF_KEY)
  if (ltcf) {
    const monthlyNet = (ltcf.monthlyIncome || 0) - (ltcf.monthlyExpenses || 0)
    lines.push(`## LONG-TERM CASH FLOW PROJECTION`)
    lines.push(`- Horizon: ${ltcf.horizon} year(s)`)
    lines.push(`- Monthly income: ${fmtMoney(ltcf.monthlyIncome || 0)}`)
    lines.push(`- Monthly expenses: ${fmtMoney(ltcf.monthlyExpenses || 0)}`)
    lines.push(`- Monthly net: ${monthlyNet >= 0 ? '+' : ''}${fmtMoney(monthlyNet)}`)
    lines.push(`- Income growth: ${ltcf.incomeGrowthRate || 0}%/yr | Expense growth: ${ltcf.expenseGrowthRate || 0}%/yr`)
    if (ltcf.bonusAmount > 0) lines.push(`- Annual bonus: ${fmtMoney(ltcf.bonusAmount)}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── Simple markdown renderer ─────────────────────────────────────────────────
// Handles **bold**, line breaks, and leading "- " bullet indentation
function renderContent(text) {
  return text.split('\n').map((line, li, arr) => {
    const boldParts = line.split(/(\*\*[^*]+\*\*)/)
    const rendered = boldParts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part
    )
    return (
      <span key={li}>
        {rendered}
        {li < arr.length - 1 && <br />}
      </span>
    )
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AIAdvisor({ transactions }) {
  const [messages,      setMessages]      = useState([])
  const [input,         setInput]         = useState('')
  const [isTyping,      setIsTyping]      = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [suggestions]                     = useState(pickSuggestions)

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  // Load history from Supabase on mount
  useEffect(() => {
    getAppData(HISTORY_KEY)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setMessages(data)
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [])

  // Persist last 20 messages to Supabase when they change
  useEffect(() => {
    if (!historyLoaded || messages.length === 0) return
    setAppData(HISTORY_KEY, messages.slice(-20)).catch(console.error)
  }, [messages, historyLoaded])

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Build financial context from transactions + localStorage
  const financialContext = useMemo(
    () => buildFinancialContext(transactions),
    [transactions],
  )

  const systemPrompt = `You are Sage, a friendly and knowledgeable personal financial advisor built into the Sage personal finance app. You help users understand their finances and make smart decisions with their money.

Here is the user's complete financial data as of today:

${financialContext}

How to respond:
- Be warm, conversational, and encouraging — you're a trusted advisor, not a textbook
- Always reference specific numbers from the data above when relevant (e.g. "Based on your $X monthly take-home...")
- Give concrete, actionable advice — not vague platitudes
- Keep responses focused (2–4 paragraphs unless the user asks for more detail)
- When giving tax or investment advice, always add: "Note: I'm not a licensed financial or tax advisor — please consult a professional for advice tailored to your situation."
- Be honest about areas for improvement while staying positive
- If the user asks about something not in the data, acknowledge that and give general guidance`

  async function sendMessage(text) {
    const content = text.trim()
    if (!content || isTyping) return

    const userMsg = { role: 'user', content, id: `u${Date.now()}` }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    try {
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
      if (!apiKey) {
        throw new Error(
          'No API key found. Add VITE_ANTHROPIC_API_KEY=your-key to your .env file and restart the dev server.'
        )
      }

      // Last 10 messages as conversation history for the API
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      history.push({ role: 'user', content })

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-request-source': 'browser',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: history,
        }),
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        throw new Error(errBody.error?.message || `API responded with status ${response.status}`)
      }

      const data            = await response.json()
      const assistantText   = data.content?.[0]?.text ?? '(empty response)'
      const assistantMsg    = { role: 'assistant', content: assistantText, id: `a${Date.now()}` }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg = {
        role: 'assistant',
        content: `Sorry, I ran into an issue: ${err.message}`,
        id: `e${Date.now()}`,
        isError: true,
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsTyping(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function clearConversation() {
    setMessages([])
    setAppData(HISTORY_KEY, []).catch(console.error)
  }

  return (
    <div className="advisor-wrap">

      {/* Header */}
      <div className="advisor-header">
        <div className="advisor-header-left">
          <div className="advisor-avatar-lg">S</div>
          <div>
            <h2 className="advisor-title">Sage</h2>
            <p className="advisor-subtitle">Personal Financial Advisor · Powered by AI</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button className="advisor-clear-btn" onClick={clearConversation}>
            Clear conversation
          </button>
        )}
      </div>

      {/* Chat window */}
      <div className="advisor-chat-window">

        {messages.length === 0 && !isTyping && (
          <div className="advisor-empty-state">
            <div className="advisor-empty-avatar">S</div>
            <p className="advisor-empty-title">Hi! I'm Sage, your financial advisor.</p>
            <p className="advisor-empty-desc">
              I have access to your real financial data — your transactions, budget, net worth,
              savings goals, ESPP, bills, and long-term projections. Ask me anything.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`advisor-msg-row ${msg.role === 'user' ? 'advisor-msg-right' : 'advisor-msg-left'}`}
          >
            {msg.role === 'assistant' && (
              <div className="advisor-msg-avatar">S</div>
            )}
            <div className={`advisor-bubble ${
              msg.role === 'user'
                ? 'advisor-bubble-user'
                : msg.isError
                  ? 'advisor-bubble-error'
                  : 'advisor-bubble-assistant'
            }`}>
              {renderContent(msg.content)}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="advisor-msg-row advisor-msg-left">
            <div className="advisor-msg-avatar">S</div>
            <div className="advisor-bubble advisor-bubble-assistant advisor-typing">
              <span className="advisor-dot" />
              <span className="advisor-dot" />
              <span className="advisor-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested questions */}
      <div className="advisor-suggestions">
        {suggestions.map((q, i) => (
          <button
            key={i}
            className="advisor-suggestion-btn"
            onClick={() => sendMessage(q)}
            disabled={isTyping}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div className="advisor-input-row">
        <input
          ref={inputRef}
          className="advisor-input"
          type="text"
          placeholder="Ask Sage anything about your finances..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping}
        />
        <button
          className="advisor-send-btn"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isTyping}
        >
          Send
        </button>
      </div>

    </div>
  )
}
