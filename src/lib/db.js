import { supabase } from './supabase'

// ── Transactions ──────────────────────────────────────────────────────────────

export async function fetchTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function upsertTransaction(tx) {
  const { error } = await supabase
    .from('transactions')
    .upsert([tx])
  if (error) throw error
}

export async function removeTransaction(id) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── App Data (key-value store for all other settings) ─────────────────────────

export async function getAppData(key) {
  const { data, error } = await supabase
    .from('app_data')
    .select('value')
    .eq('key', key)
    .single()
  // PGRST116 = no rows found — not an error, just no data yet
  if (error && error.code !== 'PGRST116') throw error
  return data?.value ?? null
}

export async function setAppData(key, value) {
  const { error } = await supabase
    .from('app_data')
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ── Startup sync: pull all cloud config into localStorage ─────────────────────
//
// Maps Supabase app_data keys to the localStorage keys each component reads.
// Called once on app startup so components continue to read localStorage
// as usual while Supabase becomes the cloud source of truth.

const KEY_MAP = [
  { cloud: 'budget',           local: 'finance_budget'   },
  { cloud: 'loans',            local: 'finance_loans'    },
  { cloud: 'net_worth',        local: 'finance_networth' },
  { cloud: 'household',        local: 'sage_household'   },
  { cloud: 'retirement',       local: 'sage_retirement'  },
  { cloud: 'tax',              local: 'sage_tax'         },
  { cloud: 'debt_payoff',      local: 'sage_debtpayoff'  },
  { cloud: 'emergency_fund',   local: 'sage_emergency'   },
  { cloud: 'investments',      local: 'sage_investments'  },
  { cloud: 'financial_health', local: 'sage_health'      },
]

export async function syncAllFromCloud() {
  await Promise.allSettled(
    KEY_MAP.map(async ({ cloud, local }) => {
      const val = await getAppData(cloud)
      if (val !== null) {
        localStorage.setItem(local, JSON.stringify(val))
      } else {
        // Nothing in cloud yet — migrate existing localStorage data up
        const existing = localStorage.getItem(local)
        if (existing) {
          try { await setAppData(cloud, JSON.parse(existing)) } catch { /* ignore */ }
        }
      }
    })
  )
}
