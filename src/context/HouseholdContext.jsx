import { createContext, useContext, useState, useEffect } from 'react'

const Ctx = createContext(null)
const KEY = 'sage_household'
const DEFAULTS = { p1: 'Alex', p2: 'Jordan' }

export function HouseholdProvider({ children }) {
  const [household, setHousehold] = useState(() => {
    try {
      const s = localStorage.getItem(KEY)
      return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS
    } catch { return DEFAULTS }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(household))
  }, [household])

  return <Ctx.Provider value={{ household, setHousehold }}>{children}</Ctx.Provider>
}

export function useHousehold() {
  return useContext(Ctx)
}
