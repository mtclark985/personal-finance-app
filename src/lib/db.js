import { supabase } from './supabase'

// ── Auth helper ───────────────────────────────────────────────────────────────
// Uses getSession() which reads from local cache — fast, no network request.

export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function fetchTransactions() {
  const user = await getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function upsertTransaction(tx) {
  const user = await getUser()
  if (!user) return
  const { error } = await supabase
    .from('transactions')
    .upsert([{ ...tx, user_id: user.id }])
  if (error) throw error
}

export async function removeTransaction(id) {
  const user = await getUser()
  if (!user) return
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── App Data (key-value store for all other settings) ─────────────────────────

export async function getAppData(key) {
  const user = await getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('app_data')
    .select('value')
    .eq('key', key)
    .eq('user_id', user.id)
    .single()
  // PGRST116 = no rows found — not an error, just no data yet
  if (error && error.code !== 'PGRST116') throw error
  return data?.value ?? null
}

export async function setAppData(key, value) {
  const user = await getUser()
  if (!user) return
  const { error } = await supabase
    .from('app_data')
    .upsert(
      { key, value, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    )
  if (error) throw error
}

// ── Startup sync: pull all cloud config into localStorage ─────────────────────
//
// Maps Supabase app_data keys to the localStorage keys each component reads.
// Called once on app startup so components continue to read localStorage
// as usual while Supabase becomes the cloud source of truth.

const KEY_MAP = [
  { cloud: 'budget',                   local: 'finance_budget'                },
  { cloud: 'loans',                    local: 'finance_loans'                 },
  { cloud: 'net_worth',                local: 'finance_networth'              },
  { cloud: 'household',                local: 'sage_household'                },
  { cloud: 'retirement',               local: 'sage_retirement'               },
  { cloud: 'tax',                      local: 'sage_tax'                      },
  { cloud: 'debt_payoff',              local: 'sage_debtpayoff'               },
  { cloud: 'emergency_fund',           local: 'sage_emergency'                },
  { cloud: 'investments',              local: 'sage_investments'              },
  { cloud: 'financial_health',         local: 'sage_health'                   },
  { cloud: 'bills',                    local: 'finance_bills'                 },
  { cloud: 'savings_goals',            local: 'finance_savings_goals'         },
  { cloud: 'cashflow_balances',        local: 'cashflow_balances'             },
  { cloud: 'longterm_cashflow_settings', local: 'longterm_cashflow_settings'  },
  { cloud: 'espp_data',                local: 'espp_data'                     },
  { cloud: 'equity_grants',            local: 'finance_equity'                },
  { cloud: 'rental_properties',        local: 'finance_rentals'               },
  { cloud: 'passive_income',           local: 'finance_passive'               },
  { cloud: 'ai_advisor_history',       local: 'ai_advisor_history'            },
]

export async function syncAllFromCloud() {
  const user = await getUser()
  if (!user) return   // Not logged in — nothing to sync

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
