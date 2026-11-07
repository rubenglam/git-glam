import { useEffect, useState } from 'react'

export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved ?? initial } catch { return initial } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }, [key, value])
  return [value, setValue]
}
