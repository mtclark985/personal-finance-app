import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getAppData, setAppData } from '../lib/db'

const Ctx = createContext(null)
const KEY = 'sage_household'
const DEFAULTS = { p1: 'Alex', p2: 'Jordan' }

export function HouseholdProvider({ children }) {
  const [household, setHouseholdState] = useState(() => {
    try {
      const s = localStorage.getItem(KEY)
      return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS
    } catch { return DEFAULTS }
  })

  // Pull from Supabase on mount (may override localStorage if cloud has newer data)
  useEffect(() => {
    getAppData('household')
      .then(val => {
        if (val) {
          const merged = { ...DEFAULTS, ...val }
          setHouseholdState(merged)
          localStorage.setItem(KEY, JSON.stringify(merged))
        }
      })
      .catch(() => {})
  }, [])

  const setHousehold = useCallback((updater) => {
    setHouseholdState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      localStorage.setItem(KEY, JSON.stringify(next))
      setAppData('household', next).catch(console.error)
      return next
    })
  }, [])

  return <Ctx.Provider value={{ household, setHousehold }}>{children}</Ctx.Provider>
}

export function useHousehold() {
  return useContext(Ctx)
}
