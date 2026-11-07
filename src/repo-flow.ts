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

// Runs a working-tree task (stage, unstage, hunk...) and always refreshes afterwards.
// Returns the task failure (if any) so the caller can show it *after* the refresh, which clears errors.
export async function applyChange(root: string, task: (root: string) => Promise<unknown>, refresh: () => Promise<void>): Promise<string> {
  let failure = ''
  try { await task(root) } catch (error) { failure = errorMessage(error) }
  await refresh()
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
