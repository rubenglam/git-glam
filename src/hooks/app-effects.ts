import { useEffect, useRef } from 'react'
import { errorMessage, fetchAndReload, type LatestState } from '../lib/repo-flow.ts'

interface BackgroundRefreshOptions {
  state: LatestState
  request: { current: number }
  autoFetchMinutes: number
  paused: boolean
  onRefreshed: (data: any, state: LatestState) => void
  onError: (message: string) => void
}

// Keeps the open repository fresh without user action: fetch on window restore and on a timer.
export function useBackgroundRefresh(options: BackgroundRefreshOptions) {
  const latest = useRef(options)
  latest.current = options
  const root = options.state.repo?.root
  const state = () => latest.current.state
  const request = () => latest.current.request.current

  useEffect(() => window.gitGraph.onRestored(async () => {
    const before = state().repo
    if (!before) return
    try {
      const result = await fetchAndReload(window.gitGraph, before.root, state, request)
      if (result) latest.current.onRefreshed(result.data, result.state)
    } catch (e) {
      if (state().repo?.root === before.root) latest.current.onError('No se pudo hacer fetch al restaurar: ' + errorMessage(e))
    }
  }), [])

  useEffect(() => {
    if (!options.autoFetchMinutes || !root || options.paused) return
    const tick = async () => {
      const current = state()
      if (document.hidden || current.busy || current.repo?.root !== root) return
      try {
        const result = await fetchAndReload(window.gitGraph, root, state, request)
        if (result) latest.current.onRefreshed(result.data, result.state)
      } catch { /* A failed background fetch is silent; the next tick retries. */ }
    }
    const timer = setInterval(tick, options.autoFetchMinutes * 60000)
    return () => clearInterval(timer)
  }, [options.autoFetchMinutes, root, options.paused])
}

const isTyping = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')

// F5 reloads the repository (only when that makes sense; the key is always swallowed).
export function useRefreshShortcut(refresh: () => void, enabled: boolean) {
  const latest = useRef({ refresh, enabled })
  latest.current = { refresh, enabled }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      if (!event.repeat && latest.current.enabled) latest.current.refresh()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

// Ctrl+F or "/" focuses the settings search or opens the commit search; Escape closes the commit details.
export function useSearchShortcuts(showSettings: boolean, openSearch: () => void, clearSelection: () => void) {
  const latest = useRef({ openSearch, clearSelection })
  latest.current = { openSearch, clearSelection }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === '/' && !isTyping()
      if (showSettings) {
        if ((e.ctrlKey && e.key.toLowerCase() === 'f') || slash) { e.preventDefault(); document.querySelector<HTMLInputElement>('.settings-search input')?.focus() }
        return
      }
      if (((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') || slash) {
        e.preventDefault(); latest.current.openSearch()
        setTimeout(() => document.querySelector<HTMLInputElement>('.search-input')?.focus(), 0)
      }
      if (e.key === 'Escape') latest.current.clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings])
}
