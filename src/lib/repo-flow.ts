// Framework-free workflows shared by the UI: no React, no DOM, so they can be tested with a fake git API.

export interface RepoLike {
  root: string
  commits: { hash: string }[]
  stashes?: { hash: string }[]
}

export interface SelectableCommit { hash: string; stash?: unknown }

export interface CommitApi {
  commit(dir: string, message: string, options: { amend: boolean }): Promise<unknown>
  commitAndPush(dir: string, message: string, options: { amend: boolean }): Promise<unknown>
}

export const errorMessage = (error: any): string => error?.message || String(error)

// Re-resolves the selected commit/stash against a freshly loaded repository (null when it no longer exists).
export function updatedSelection<R extends RepoLike>(repo: R, selected: SelectableCommit | null | undefined) {
  if (!selected) return null
  const list: { hash: string }[] | undefined = selected.stash ? repo.stashes : repo.commits
  return list?.find(item => item.hash === selected.hash) || null
}

// Runs a working-tree task (stage, unstage, hunk...) and refreshes afterwards.
// When `watched` is true the file watcher reloads the repo on its own after the task changes git's index,
// so the explicit refresh is skipped (it would load the repository twice). A failure still refreshes to clear errors.
// Returns the task failure (if any) so the caller can show it *after* the refresh, which clears errors.
export async function applyChange(root: string, task: (root: string) => Promise<unknown>, refresh: () => Promise<void>, watched = false): Promise<string> {
  let failure = ''
  try { await task(root) } catch (error) { failure = errorMessage(error) }
  if (failure || !watched) await refresh()
  return failure
}

export interface CommitOutcome {
  committed: boolean
  pushed: boolean
  error?: string
}

// Commit (optionally with push). A push failure after a successful commit still reports `committed`.
export async function performCommit(api: CommitApi, dir: string, message: string, options: { amend: boolean, push: boolean }): Promise<CommitOutcome> {
  try {
    await (options.push ? api.commitAndPush : api.commit).call(api, dir, message, { amend: options.amend })
    return { committed: true, pushed: options.push }
  } catch (error) {
    const text = errorMessage(error)
    return { committed: options.push && /commit se creó/.test(text), pushed: false, error: text }
  }
}

export type SyncKind = 'fetch' | 'pull' | 'push' | 'sync'

export interface SyncApi {
  fetch(root: string): Promise<unknown>
  pull(root: string): Promise<unknown>
  push(root: string): Promise<unknown>
  load(root: string, showRemote: boolean, limit?: number): Promise<any>
}

const SYNC_NOTICES = { fetch: 'Fetch completado', pull: 'Pull completado', push: 'Push completado', sync: 'Sincronización completada' }

// Fetch / pull / push, or the combined sync (fetch, then pull if behind, then push if ahead).
// Never throws: a failure is returned so the caller can still refresh the repository afterwards.
export async function runSync(api: SyncApi, root: string, kind: SyncKind, showRemote: boolean, limit?: number): Promise<{ notice?: string, failure?: string }> {
  try {
    if (kind === 'sync') {
      await api.fetch(root)
      const refreshed = await api.load(root, showRemote, limit)
      const info = refreshed.sync?.[refreshed.branch]
      if (!info || info.gone) throw new Error('La rama de seguimiento ya no está disponible tras el fetch. No se ha hecho pull ni push.')
      if (info.behind) await api.pull(root)
      if (info.ahead) await api.push(root)
    } else await api[kind](root)
    return { notice: SYNC_NOTICES[kind] }
  } catch (error) { return { failure: errorMessage(error) } }
}

export interface LatestState {
  repo?: { root: string, commits: unknown[] } | null
  busy: boolean
  showRemote: boolean
  activeProject: unknown
}

export interface BackgroundApi {
  fetch(root: string): Promise<unknown>
  load(root: string, showRemote: boolean, limit?: number): Promise<any>
}

// Fetch + reload used by auto-fetch and restore-from-minimize. Returns null if the user did something
// in the meantime (busy, another project, a newer request), so stale data never overwrites fresh state.
// API errors propagate to the caller.
export async function fetchAndReload(api: BackgroundApi, root: string, latest: () => LatestState, request: () => number): Promise<{ data: any, state: LatestState } | null> {
  const started = request()
  await api.fetch(root)
  return loadIfCurrent(api, root, latest, request, started)
}

// Reload without network access, used when files change on disk (the same contract as fetchAndReload).
export async function reloadLocal(api: Pick<BackgroundApi, 'load'>, root: string, latest: () => LatestState, request: () => number): Promise<{ data: any, state: LatestState } | null> {
  return loadIfCurrent(api, root, latest, request, request())
}

async function loadIfCurrent(api: Pick<BackgroundApi, 'load'>, root: string, latest: () => LatestState, request: () => number, started: number): Promise<{ data: any, state: LatestState } | null> {
  const stale = (state: LatestState) => started !== request() || state.busy || state.repo?.root !== root
  const now = latest()
  if (stale(now)) return null
  const data = await api.load(root, now.showRemote, now.repo!.commits.length)
  const after = latest()
  if (stale(after)) return null
  return { data, state: after }
}

export interface ProjectRefreshApi {
  projects: { select(path: string): Promise<unknown> }
  load(root: string, showRemote: boolean, limit?: number): Promise<any>
}

export interface CachedProjectRefresh { selectionError?: string, repo?: any, refreshError?: string }

// Re-opens a cached project: saves the selection and reloads in parallel. Returns null when a newer
// request superseded this one while it was in flight (the caller must then ignore the result).
export async function refreshCachedProject(api: ProjectRefreshApi, path: string, cached: { repo: any }, showRemote: boolean, isCurrent: () => boolean): Promise<CachedProjectRefresh | null> {
  const [selection, refreshed] = await Promise.allSettled([api.projects.select(path), api.load(cached.repo.root, showRemote, cached.repo.commits.length)])
  if (!isCurrent()) return null
  const result: CachedProjectRefresh = {}
  if (selection.status === 'rejected') result.selectionError = `No se pudo guardar la selección: ${errorMessage(selection.reason)}`
  if (refreshed.status === 'fulfilled') result.repo = refreshed.value
  else result.refreshError = `No se pudo actualizar «${path}»: ${errorMessage(refreshed.reason)}`
  return result
}
