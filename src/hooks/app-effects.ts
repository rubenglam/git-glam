import { useEffect, useRef } from 'react'
import { errorMessage, fetchAndReload, reloadLocal, type LatestState } from '../lib/repo-flow.ts'

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

// Reloads the open repository when its files or git metadata change on disk, like VS Code's source control view.
// Unlike auto-fetch this never touches the network, so it runs as often as the files change.
// Root whose file watcher is active. The backend keeps one watcher at a time.
let watchedRoot: string | null = null
export const isRepoWatched = (root: string) => watchedRoot === root

export function useRepoWatch(options: Omit<BackgroundRefreshOptions, 'autoFetchMinutes'>) {
  const latest = useRef(options)
  latest.current = options
  const root = options.state.repo?.root
  useEffect(() => {
    if (!root) { watchedRoot = null; void window.gitGraph.unwatch().catch(() => {}); return }
    // Without a watcher the periodic and restore refreshes still apply, so failures are silent.
    void window.gitGraph.watch(root).then(() => { watchedRoot = root }).catch(() => {})
    const stopWatching = () => { if (watchedRoot === root) watchedRoot = null }
    let ticket = 0
    const state = () => latest.current.state
    const off = window.gitGraph.onRepoChanged(changed => {
      if (changed !== root) return
      const current = ++ticket
      reloadLocal(window.gitGraph, root, state, () => latest.current.request.current)
        .then(result => { if (result && current === ticket) latest.current.onRefreshed(result.data, result.state) })
        .catch(() => { /* A failed background reload is silent; the next change retries. */ })
    })
    return () => { off(); stopWatching() }
  }, [root])
}

const isTyping = () =>['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')

// F5 reloads the whole app window.
export function useReloadShortcut() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      if (!event.repeat) window.location.reload()
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
