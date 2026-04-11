import { useState, useEffect, useRef, useMemo } from 'react'
import TransactionForm from './components/TransactionForm'
import TransactionList from './components/TransactionList'
import SpendingChart from './components/SpendingChart'
import Dashboard from './components/Dashboard'
import BudgetPlanner from './components/BudgetPlanner'
import NetWorth from './components/NetWorth'
import Loans from './components/Loans'
import CashFlow from './components/CashFlow'
import RetirementCalc from './components/RetirementCalc'
import TaxEstimator from './components/TaxEstimator'
import EmergencyFund from './components/EmergencyFund'
import InvestmentAllocation from './components/InvestmentAllocation'
import DebtPayoff from './components/DebtPayoff'
import Bills from './components/Bills'
import SavingsGoals from './components/SavingsGoals'
import LongTermCashFlow from './components/LongTermCashFlow'
import FinancialHealthScore from './components/FinancialHealthScore'
import ESPP from './components/ESPP'
import Equity from './components/Equity'
import RentalProperties from './components/RentalProperties'
import PassiveIncome from './components/PassiveIncome'
import AIAdvisor from './components/AIAdvisor'
import Landing from './components/Landing'
import Auth from './components/Auth'
import { useHousehold } from './context/HouseholdContext'
import { supabase } from './lib/supabase'
import {
  fetchTransactions, upsertTransaction, removeTransaction,
  syncAllFromCloud, getAppData, setAppData,
} from './lib/db'
import './App.css'

function loadSpendingMode() {
  try {
    const s = localStorage.getItem('spending_mode_cfg')
    if (s) return { mode: 'detailed', monthly: 1500, ...JSON.parse(s) }
  } catch {}
  return { mode: 'detailed', monthly: 1500 }
}

function SpendingModeCard({ mode, monthly, onChange }) {
  return (
    <div className="card spending-mode-card">
      <div className="spending-mode-header">
        <div>
          <h3 className="spending-mode-title">Spending Tracking</h3>
          <p className="spending-mode-desc">
            {mode === 'simple'
              ? 'Using a monthly lump sum for discretionary spending. Cash flow forecasts use this amount.'
              : 'Tracking individual transactions. Cash flow forecasts use your budget line items.'}
          </p>
        </div>
        <div className="spending-mode-toggle">
          <button
            className={`spending-mode-btn${mode === 'detailed' ? ' active' : ''}`}
            onClick={() => onChange({ mode: 'detailed' })}
          >
            Detailed
          </button>
          <button
            className={`spending-mode-btn${mode === 'simple' ? ' active' : ''}`}
            onClick={() => onChange({ mode: 'simple' })}
          >
            Simple
          </button>
        </div>
      </div>
      {mode === 'simple' && (
        <div className="spending-mode-amount">
          <label className="rc-label">Monthly discretionary budget</label>
          <div className="spending-mode-input-row">
            <div className="nw-num-wrap">
              <span className="nw-prefix">$</span>
              <input
                className="nw-num-input"
                type="number"
                min="0"
                step="50"
                style={{ width: '120px' }}
                value={monthly || ''}
                placeholder="0"
                onChange={e => onChange({ monthly: parseFloat(e.target.value) || 0 })}
              />
              <span className="nw-suffix">/month</span>
            </div>
            <p className="spending-mode-hint">
              Covers all discretionary spending beyond your tracked bills. Flows into Cash Flow forecasts automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const STORAGE_KEY = 'finance_transactions'

const SAMPLE_TRANSACTIONS = [
  // --- December 2025 ---
  { id: 'd01', type: 'income',  amount: 4200,   category: 'Salary',             date: '2025-12-01', description: 'Monthly salary' },
  { id: 'd02', type: 'income',  amount: 300,    category: 'Freelance',          date: '2025-12-14', description: 'Logo design gig' },
  { id: 'd03', type: 'expense', amount: 1350,   category: 'Housing & Utilities',date: '2025-12-01', description: 'Rent' },
  { id: 'd04', type: 'expense', amount: 112,    category: 'Housing & Utilities',date: '2025-12-05', description: 'Electric & heating bill' },
  { id: 'd05', type: 'expense', amount: 198,    category: 'Food & Dining',      date: '2025-12-06', description: 'Groceries' },
  { id: 'd06', type: 'expense', amount: 220,    category: 'Food & Dining',      date: '2025-12-20', description: 'Holiday groceries' },
  { id: 'd07', type: 'expense', amount: 64,     category: 'Food & Dining',      date: '2025-12-15', description: 'Holiday dinner out' },
  { id: 'd08', type: 'expense', amount: 85,     category: 'Transportation',     date: '2025-12-01', description: 'Monthly transit pass' },
  { id: 'd09', type: 'expense', amount: 42,     category: 'Transportation',     date: '2025-12-18', description: 'Gas' },
  { id: 'd10', type: 'expense', amount: 15.99,  category: 'Entertainment',      date: '2025-12-01', description: 'Netflix' },
  { id: 'd11', type: 'expense', amount: 12.99,  category: 'Entertainment',      date: '2025-12-01', description: 'Spotify' },
  { id: 'd12', type: 'expense', amount: 38,     category: 'Entertainment',      date: '2025-12-22', description: 'Movie tickets' },
  { id: 'd13', type: 'expense', amount: 45,     category: 'Health & Fitness',   date: '2025-12-01', description: 'Gym membership' },
  { id: 'd14', type: 'expense', amount: 285,    category: 'Shopping',           date: '2025-12-10', description: 'Holiday gifts' },
  { id: 'd15', type: 'expense', amount: 76,     category: 'Shopping',           date: '2025-12-26', description: 'Post-holiday sale' },
  { id: 'd16', type: 'expense', amount: 22,     category: 'Personal Care',      date: '2025-12-12', description: 'Haircut' },
  { id: 'd17', type: 'income',  amount: 500,    category: 'Gift',               date: '2025-12-25', description: 'Holiday gift money' },

  // --- January 2026 ---
  { id: 'j01', type: 'income',  amount: 4200,   category: 'Salary',             date: '2026-01-01', description: 'Monthly salary' },
  { id: 'j02', type: 'income',  amount: 480,    category: 'Freelance',          date: '2026-01-18', description: 'Dashboard UI contract' },
  { id: 'j03', type: 'expense', amount: 1350,   category: 'Housing & Utilities',date: '2026-01-01', description: 'Rent' },
  { id: 'j04', type: 'expense', amount: 98,     category: 'Housing & Utilities',date: '2026-01-04', description: 'Electric bill' },
  { id: 'j05', type: 'expense', amount: 32,     category: 'Housing & Utilities',date: '2026-01-06', description: 'Internet bill' },
  { id: 'j06', type: 'expense', amount: 205,    category: 'Food & Dining',      date: '2026-01-05', description: 'Groceries' },
  { id: 'j07', type: 'expense', amount: 195,    category: 'Food & Dining',      date: '2026-01-19', description: 'Groceries' },
  { id: 'j08', type: 'expense', amount: 34,     category: 'Food & Dining',      date: '2026-01-11', description: 'Lunch with coworkers' },
  { id: 'j09', type: 'expense', amount: 85,     category: 'Transportation',     date: '2026-01-01', description: 'Monthly transit pass' },
  { id: 'j10', type: 'expense', amount: 36,     category: 'Transportation',     date: '2026-01-14', description: 'Gas' },
  { id: 'j11', type: 'expense', amount: 15.99,  category: 'Entertainment',      date: '2026-01-01', description: 'Netflix' },
  { id: 'j12', type: 'expense', amount: 12.99,  category: 'Entertainment',      date: '2026-01-01', description: 'Spotify' },
  { id: 'j13', type: 'expense', amount: 45,     category: 'Health & Fitness',   date: '2026-01-01', description: 'Gym membership' },
  { id: 'j14', type: 'expense', amount: 89,     category: 'Health & Fitness',   date: '2026-01-08', description: 'Doctor visit copay' },
  { id: 'j15', type: 'expense', amount: 52,     category: 'Shopping',           date: '2026-01-20', description: 'Home supplies' },
  { id: 'j16', type: 'expense', amount: 59,     category: 'Education',          date: '2026-01-10', description: 'Udemy courses' },
  { id: 'j17', type: 'expense', amount: 22,     category: 'Personal Care',      date: '2026-01-25', description: 'Haircut' },

  // --- February 2026 ---
  { id: 'f01', type: 'income',  amount: 4200,   category: 'Salary',             date: '2026-02-01', description: 'Monthly salary' },
  { id: 'f02', type: 'income',  amount: 750,    category: 'Freelance',          date: '2026-02-22', description: 'Mobile app consulting' },
  { id: 'f03', type: 'expense', amount: 1350,   category: 'Housing & Utilities',date: '2026-02-01', description: 'Rent' },
  { id: 'f04', type: 'expense', amount: 88,     category: 'Housing & Utilities',date: '2026-02-03', description: 'Electric bill' },
  { id: 'f05', type: 'expense', amount: 32,     category: 'Housing & Utilities',date: '2026-02-06', description: 'Internet bill' },
  { id: 'f06', type: 'expense', amount: 215,    category: 'Food & Dining',      date: '2026-02-07', description: 'Groceries' },
  { id: 'f07', type: 'expense', amount: 190,    category: 'Food & Dining',      date: '2026-02-21', description: 'Groceries' },
  { id: 'f08', type: 'expense', amount: 88,     category: 'Food & Dining',      date: '2026-02-14', description: "Valentine's dinner" },
  { id: 'f09', type: 'expense', amount: 85,     category: 'Transportation',     date: '2026-02-01', description: 'Monthly transit pass' },
  { id: 'f10', type: 'expense', amount: 40,     category: 'Transportation',     date: '2026-02-10', description: 'Gas' },
  { id: 'f11', type: 'expense', amount: 15.99,  category: 'Entertainment',      date: '2026-02-01', description: 'Netflix' },
  { id: 'f12', type: 'expense', amount: 12.99,  category: 'Entertainment',      date: '2026-02-01', description: 'Spotify' },
  { id: 'f13', type: 'expense', amount: 72,     category: 'Entertainment',      date: '2026-02-08', description: 'Live show tickets' },
  { id: 'f14', type: 'expense', amount: 45,     category: 'Health & Fitness',   date: '2026-02-01', description: 'Gym membership' },
  { id: 'f15', type: 'expense', amount: 110,    category: 'Shopping',           date: '2026-02-16', description: 'Clothing sale' },
  { id: 'f16', type: 'expense', amount: 22,     category: 'Personal Care',      date: '2026-02-20', description: 'Haircut' },
  { id: 'f17', type: 'income',  amount: 200,    category: 'Investment',         date: '2026-02-28', description: 'Dividend payout' },

  // --- March 2026 ---
  { id: 'm01', type: 'income',  amount: 4200,   category: 'Salary',             date: '2026-03-01', description: 'Monthly salary' },
  { id: 'm02', type: 'income',  amount: 650,    category: 'Freelance',          date: '2026-03-05', description: 'Web design project' },
  { id: 'm03', type: 'expense', amount: 1350,   category: 'Housing & Utilities',date: '2026-03-01', description: 'Rent' },
  { id: 'm04', type: 'expense', amount: 94,     category: 'Housing & Utilities',date: '2026-03-03', description: 'Electric & gas bill' },
  { id: 'm05', type: 'expense', amount: 32,     category: 'Housing & Utilities',date: '2026-03-06', description: 'Internet bill' },
  { id: 'm06', type: 'expense', amount: 210,    category: 'Food & Dining',      date: '2026-03-04', description: 'Groceries' },
  { id: 'm07', type: 'expense', amount: 47.50,  category: 'Food & Dining',      date: '2026-03-07', description: 'Dinner out' },
  { id: 'm08', type: 'expense', amount: 18,     category: 'Food & Dining',      date: '2026-03-10', description: 'Coffee & lunch' },
  { id: 'm09', type: 'expense', amount: 85,     category: 'Transportation',     date: '2026-03-02', description: 'Monthly transit pass' },
  { id: 'm10', type: 'expense', amount: 38,     category: 'Transportation',     date: '2026-03-09', description: 'Gas' },
  { id: 'm11', type: 'expense', amount: 15.99,  category: 'Entertainment',      date: '2026-03-01', description: 'Netflix' },
  { id: 'm12', type: 'expense', amount: 12.99,  category: 'Entertainment',      date: '2026-03-01', description: 'Spotify' },
  { id: 'm13', type: 'expense', amount: 62,     category: 'Entertainment',      date: '2026-03-08', description: 'Concert tickets' },
  { id: 'm14', type: 'expense', amount: 45,     category: 'Health & Fitness',   date: '2026-03-01', description: 'Gym membership' },
  { id: 'm15', type: 'expense', amount: 28,     category: 'Health & Fitness',   date: '2026-03-06', description: 'Vitamins & supplements' },
  { id: 'm16', type: 'expense', amount: 134,    category: 'Shopping',           date: '2026-03-05', description: 'Clothing' },
  { id: 'm17', type: 'expense', amount: 22.40,  category: 'Personal Care',      date: '2026-03-03', description: 'Haircut' },
  { id: 'm18', type: 'income',  amount: 120,    category: 'Gift',               date: '2026-03-10', description: 'Birthday money' },
  { id: 'm19', type: 'expense', amount: 49,     category: 'Education',          date: '2026-03-08', description: 'Online course' },
]

function getCurrentYearMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function EditableName({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)

  if (editing) {
    return (
      <input
        autoFocus
        className="earner-edit-input"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onClick={e => e.stopPropagation()}
        onBlur={() => { onSave(draft.trim() || value); setEditing(false) }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter')  { onSave(draft.trim() || value); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
      />
    )
  }
  return (
    <>
      {value}
      <span
        className="earner-pencil"
        title="Double-click to rename"
        onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      >✎</span>
    </>
  )
}

const NAV = [
  { key: 'dashboard',    label: 'Dashboard'      },
  { key: 'transactions', label: 'Transactions'   },
  { key: 'cashflow',     label: 'Cash Flow'      },
  { key: 'budget',       label: 'Budget & Bills' },
  { key: 'networth',     label: 'Net Worth'      },
  {
    key: 'investments-group', label: 'Investments', group: true,
    children: [
      { key: 'investments', label: 'Portfolio'     },
      { key: 'espp',        label: 'ESPP'          },
      { key: 'equity',      label: 'Equity'        },
      { key: 'rentals',     label: 'Rentals'       },
      { key: 'passive',     label: 'Passive Income'},
    ]
  },
  {
    key: 'planning-group', label: 'Planning', group: true,
    children: [
      { key: 'retirement', label: 'Retirement'    },
      { key: 'tax',        label: 'Tax Estimator' },
      { key: 'emergency',  label: 'Emergency Fund'},
      { key: 'goals',      label: 'Savings Goals' },
    ]
  },
  {
    key: 'debt-group', label: 'Debt', group: true,
    children: [
      { key: 'loans',      label: 'Loans'      },
      { key: 'debtpayoff', label: 'Debt Payoff'},
    ]
  },
]

export default function App() {
  const { household, setHousehold } = useHousehold()
  const [transactions, setTransactions] = useState([])
  const [dbReady,      setDbReady]      = useState(false)
  const [filterYear,   setFilterYear]   = useState(getCurrentYearMonth().year)
  const [filterMonth,  setFilterMonth]  = useState(getCurrentYearMonth().month)
  const [activeTab,    setActiveTab]    = useState('dashboard')
  const [earnerView,   setEarnerView]   = useState('combined')
  const [darkMode,     setDarkMode]     = useState(() => localStorage.getItem('sage_darkmode') === 'true')

  // Spending mode
  const [spendingMode, setSpendingMode] = useState(loadSpendingMode)

  function updateSpendingMode(updates) {
    setSpendingMode(prev => {
      const next = { ...prev, ...updates }
      localStorage.setItem('spending_mode_cfg', JSON.stringify(next))
      setAppData('spending_mode', next).catch(console.error)
      return next
    })
  }

  // Nav group state — all groups open by default
  const [openGroups, setOpenGroups] = useState(
    () => new Set(['investments-group', 'planning-group', 'debt-group'])
  )

  // Merged view sub-tabs
  const [cashflowView, setCashflowView] = useState('current')  // 'current' | 'longterm'
  const [budgetView,   setBudgetView]   = useState('budget')   // 'budget' | 'bills'

  // Overlays
  const [sageOpen,   setSageOpen]   = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [addOpen,    setAddOpen]    = useState(false)

  // Auth state
  const [authState,  setAuthState]  = useState('loading')
  const [authView,   setAuthView]   = useState('login')
  const [user,       setUser]       = useState(null)
  const [isNewUser,  setIsNewUser]  = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  const initializingRef = useRef(false)

  async function initApp() {
    try {
      await syncAllFromCloud()
      const txs = await fetchTransactions()
      const initialized = await getAppData('user_initialized')
      if (!initialized) {
        await setAppData('user_initialized', true)
        await Promise.all(SAMPLE_TRANSACTIONS.map(tx => upsertTransaction(tx)))
        setTransactions(SAMPLE_TRANSACTIONS)
        setIsNewUser(true)
      } else {
        setTransactions(txs.length > 0 ? txs : [])
        setIsNewUser(false)
      }
    } catch (err) {
      console.error('App init error — falling back to empty state:', err)
      setTransactions([])
    } finally {
      setDbReady(true)
      setAuthState('app')
      initializingRef.current = false
    }
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        localStorage.clear()
        setUser(null)
        setTransactions([])
        setDbReady(false)
        setIsNewUser(false)
        setActiveTab('dashboard')
        initializingRef.current = false
        setAuthState('landing')
        return
      }
      if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        if (initializingRef.current) return
        initializingRef.current = true
        setUser(session.user)
        setAuthState('loading')
        initApp()
        return
      }
      if (event === 'INITIAL_SESSION' && !session) {
        setAuthState('landing')
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem('sage_darkmode', darkMode)
  }, [darkMode])

  useEffect(() => {
    if (!showUserMenu) return
    function handler(e) {
      if (!e.target.closest('.user-menu-wrap')) setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showUserMenu])

  // Close sage drawer on outside click
  useEffect(() => {
    if (!sageOpen) return
    function handler(e) {
      if (!e.target.closest('.sage-drawer') && !e.target.closest('.fab-sage')) {
        setSageOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sageOpen])

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function navigateTo(key) {
    setActiveTab(key)
    // Auto-open parent group when navigating to a child
    NAV.forEach(item => {
      if (item.group && item.children?.some(c => c.key === key)) {
        setOpenGroups(prev => new Set([...prev, item.key]))
      }
    })
  }

  async function signOut() {
    setShowUserMenu(false)
    await supabase.auth.signOut()
  }

  async function addTransaction(tx) {
    const newTx = { ...tx, id: crypto.randomUUID() }
    setTransactions(prev => [newTx, ...prev])
    try {
      await upsertTransaction(newTx)
    } catch (err) {
      console.error('Failed to save transaction:', err)
    }
  }

  async function deleteTransaction(id) {
    setTransactions(prev => prev.filter(tx => tx.id !== id))
    try {
      await removeTransaction(id)
    } catch (err) {
      console.error('Failed to delete transaction:', err)
    }
  }

  const filtered = useMemo(() => transactions.filter(tx => {
    const d = new Date(tx.date)
    return d.getFullYear() === filterYear && d.getMonth() + 1 === filterMonth
  }), [transactions, filterYear, filterMonth])

  const viewFiltered = useMemo(() => {
    if (earnerView === 'combined') return filtered
    return filtered.filter(tx => !tx.earner || tx.earner === 'joint' || tx.earner === earnerView)
  }, [filtered, earnerView])

  const availableMonths = useMemo(() => {
    const seen = new Set()
    transactions.forEach(tx => {
      const d = new Date(tx.date)
      seen.add(`${d.getFullYear()}-${d.getMonth() + 1}`)
    })
    const { year, month } = getCurrentYearMonth()
    seen.add(`${year}-${month}`)
    return Array.from(seen)
      .map(s => { const [y, m] = s.split('-').map(Number); return { year: y, month: m } })
      .sort((a, b) => b.year - a.year || b.month - a.month)
  }, [transactions])

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]

  const showMonthSelector = ['dashboard', 'transactions'].includes(activeTab)
  const showEarnerToggle  = ['dashboard', 'cashflow', 'transactions', 'budget', 'retirement', 'tax'].includes(activeTab)

  // ── Auth states ────────────────────────────────────────────

  if (authState === 'loading') {
    return (
      <div className="app-loading">
        <div className="app-loading-logo">S</div>
        <p className="app-loading-text">Loading Sage…</p>
      </div>
    )
  }

  if (authState === 'landing') {
    return (
      <Landing
        onGetStarted={() => { setAuthView('signup'); setAuthState('auth') }}
        onLogin={()      => { setAuthView('login');  setAuthState('auth') }}
      />
    )
  }

  if (authState === 'auth') {
    return (
      <Auth
        initialMode={authView}
        onBack={() => setAuthState('landing')}
      />
    )
  }

  if (!dbReady) {
    return (
      <div className="app-loading">
        <div className="app-loading-logo">S</div>
        <p className="app-loading-text">Loading Sage…</p>
      </div>
    )
  }

  return (
    <div className={`app${darkMode ? ' dark' : ''}`}>
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-logo">S</div>
          <div className="app-title-group">
            <span className="app-name">Sage</span>
            <span className="app-tagline">Personal Financial Advisor</span>
          </div>
        </div>

        <nav className="tab-nav">
          {NAV.map(item => {
            if (item.group) {
              const isOpen = openGroups.has(item.key)
              const isChildActive = item.children.some(c => c.key === activeTab)
              return (
                <div key={item.key} className="nav-group">
                  <button
                    className={`nav-group-header${isChildActive ? ' child-active' : ''}`}
                    onClick={() => toggleGroup(item.key)}
                  >
                    <span>{item.label}</span>
                    <span className="nav-chevron">{isOpen ? '▴' : '▾'}</span>
                  </button>
                  {isOpen && (
                    <div className="nav-group-children">
                      {item.children.map(child => (
                        <button
                          key={child.key}
                          className={`nav-child${activeTab === child.key ? ' active' : ''}`}
                          onClick={() => navigateTo(child.key)}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <button
                key={item.key}
                className={activeTab === item.key ? 'active' : ''}
                onClick={() => navigateTo(item.key)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <button className="dark-toggle" onClick={() => setDarkMode(d => !d)}>
          {darkMode ? '☀ Light Mode' : '☾ Dark Mode'}
        </button>
      </aside>

      <div className="app-content">
        <header className="app-header">
          <div className="header-controls">
            {showEarnerToggle && (
              <div className="earner-toggle">
                <button
                  className={`earner-btn ${earnerView === 'combined' ? 'active combined' : ''}`}
                  onClick={() => setEarnerView('combined')}
                >
                  Combined
                </button>
                <button
                  className={`earner-btn earner-p1 ${earnerView === 'p1' ? 'active' : ''}`}
                  onClick={() => setEarnerView('p1')}
                >
                  <EditableName
                    value={household.p1}
                    onSave={name => setHousehold(h => ({ ...h, p1: name }))}
                  />
                </button>
                <button
                  className={`earner-btn earner-p2 ${earnerView === 'p2' ? 'active' : ''}`}
                  onClick={() => setEarnerView('p2')}
                >
                  <EditableName
                    value={household.p2}
                    onSave={name => setHousehold(h => ({ ...h, p2: name }))}
                  />
                </button>
              </div>
            )}

            {showMonthSelector && (
              <div className="month-selector">
                <select
                  value={`${filterYear}-${filterMonth}`}
                  onChange={e => {
                    const [y, m] = e.target.value.split('-').map(Number)
                    setFilterYear(y); setFilterMonth(m)
                  }}
                >
                  {availableMonths.map(({ year, month }) => (
                    <option key={`${year}-${month}`} value={`${year}-${month}`}>
                      {MONTH_NAMES[month - 1]} {year}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="header-right">
            <button className="health-score-btn" onClick={() => setHealthOpen(true)} title="Financial Health Score">
              ⭐ Score
            </button>

            <div className="user-menu-wrap">
              <button
                className="user-menu-btn"
                onClick={() => setShowUserMenu(v => !v)}
                title={user?.email}
              >
                <span className="user-avatar">
                  {(user?.email?.[0] ?? '?').toUpperCase()}
                </span>
                <span className="user-email-label">{user?.email}</span>
                <span className="user-menu-chevron">{showUserMenu ? '▲' : '▼'}</span>
              </button>

              {showUserMenu && (
                <div className="user-menu-dropdown">
                  <div className="user-menu-email">{user?.email}</div>
                  <button className="user-menu-signout" onClick={signOut}>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {isNewUser && (
          <div className="welcome-banner">
            <div className="welcome-banner-content">
              <span className="welcome-banner-icon">👋</span>
              <div>
                <strong>Welcome to Sage!</strong> We've loaded some sample transactions
                so you can explore the app. Replace them with your own data anytime.
              </div>
            </div>
            <button className="welcome-banner-close" onClick={() => setIsNewUser(false)}>×</button>
          </div>
        )}

        <main className="app-main">
          {activeTab === 'dashboard' && (
            <Dashboard
              transactions={transactions}
              filtered={viewFiltered}
              year={filterYear}
              month={filterMonth}
            />
          )}

          {activeTab === 'cashflow' && (
            <>
              <div className="sub-tab-bar">
                <button
                  className={cashflowView === 'current' ? 'active' : ''}
                  onClick={() => setCashflowView('current')}
                >This Month</button>
                <button
                  className={cashflowView === 'longterm' ? 'active' : ''}
                  onClick={() => setCashflowView('longterm')}
                >Long-Term</button>
              </div>
              {cashflowView === 'current'
                ? <CashFlow transactions={transactions} earnerView={earnerView} household={household} spendingMode={spendingMode} />
                : <LongTermCashFlow transactions={transactions} spendingMode={spendingMode} />
              }
            </>
          )}

          {activeTab === 'transactions' && (
            <>
              <SpendingChart transactions={viewFiltered} />
              <TransactionList
                transactions={viewFiltered}
                onDelete={deleteTransaction}
                household={household}
              />
            </>
          )}

          {activeTab === 'budget' && (
            <>
              <SpendingModeCard
                mode={spendingMode.mode}
                monthly={spendingMode.monthly}
                onChange={updateSpendingMode}
              />
              <div className="sub-tab-bar">
                <button
                  className={budgetView === 'budget' ? 'active' : ''}
                  onClick={() => setBudgetView('budget')}
                >Budget</button>
                <button
                  className={budgetView === 'bills' ? 'active' : ''}
                  onClick={() => setBudgetView('bills')}
                >Bills</button>
              </div>
              {budgetView === 'budget'
                ? <BudgetPlanner household={household} earnerView={earnerView} />
                : <Bills />
              }
            </>
          )}

          {activeTab === 'networth'    && <NetWorth />}
          {activeTab === 'investments' && <InvestmentAllocation />}
          {activeTab === 'espp'        && <ESPP />}
          {activeTab === 'equity'      && <Equity />}
          {activeTab === 'rentals'     && <RentalProperties />}
          {activeTab === 'passive'     && <PassiveIncome />}
          {activeTab === 'retirement'  && <RetirementCalc household={household} earnerView={earnerView} />}
          {activeTab === 'tax'         && <TaxEstimator household={household} earnerView={earnerView} />}
          {activeTab === 'emergency'   && <EmergencyFund />}
          {activeTab === 'goals'       && <SavingsGoals />}
          {activeTab === 'loans'       && <Loans />}
          {activeTab === 'debtpayoff'  && <DebtPayoff />}
        </main>
      </div>

      {/* ── Floating action buttons ── */}
      <div className="fab-group">
        <button
          className={`fab fab-sage${sageOpen ? ' active' : ''}`}
          onClick={() => setSageOpen(v => !v)}
          title="Sage AI Advisor"
        >
          💬
        </button>
        <button
          className="fab fab-add"
          onClick={() => setAddOpen(true)}
          title="Add Transaction"
        >
          +
        </button>
      </div>

      {/* ── Sage drawer ── */}
      {sageOpen && (
        <div className="sage-drawer">
          <div className="sage-drawer-header">
            <span className="sage-drawer-title">💬 Sage</span>
            <button className="sage-drawer-close" onClick={() => setSageOpen(false)}>✕</button>
          </div>
          <div className="sage-drawer-body">
            <AIAdvisor transactions={transactions} />
          </div>
        </div>
      )}

      {/* ── Health Score modal ── */}
      {healthOpen && (
        <div className="modal-overlay" onClick={() => setHealthOpen(false)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setHealthOpen(false)}>✕</button>
            <FinancialHealthScore />
          </div>
        </div>
      )}

      {/* ── Add Transaction modal ── */}
      {addOpen && (
        <div className="modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAddOpen(false)}>✕</button>
            <TransactionForm
              household={household}
              onAdd={tx => {
                addTransaction(tx)
                setAddOpen(false)
                setActiveTab('transactions')
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
