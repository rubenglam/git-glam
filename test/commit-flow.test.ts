import test from 'node:test'
import assert from 'node:assert/strict'
import { applyChange, performCommit, updatedSelection } from '../src/repo-flow.ts'

// In-memory stand-in for window.gitGraph with just enough git semantics for the stage → commit → history flow.
function fakeGit(options: { pushFails?: boolean, stageFails?: boolean } = {}) {
  const state = {
    commits: [{ hash: 'c1', subject: 'init' }],
    changes: [{ path: 'a.txt', status: '??' }, { path: 'b.txt', status: ' M' }],
    remoteCommits: ['c1'],
    calls: [] as string[],
  }
  const staged = (status: string) => status[0] !== ' ' && status[0] !== '?'
  const api = {
    async stage(_dir: string, paths: string[]) {
      state.calls.push('stage')
      if (options.stageFails) throw new Error('index.lock existe')
      state.changes = state.changes.map(change => paths.includes(change.path) ? { ...change, status: 'A ' } : change)
    },
    async unstage(_dir: string, paths: string[]) {
      state.calls.push('unstage')
      state.changes = state.changes.map(change => paths.includes(change.path) ? { ...change, status: '??' } : change)
    },
    async commit(_dir: string, message: string, { amend }: { amend: boolean }) {
      state.calls.push(amend ? 'amend' : 'commit')
      if (!state.changes.some(change => staged(change.status)) && !amend) throw new Error('nada que confirmar')
      state.changes = state.changes.filter(change => !staged(change.status))
      const commit = { hash: 'c' + (state.commits.length + 1), subject: message }
      state.commits = amend ? [commit, ...state.commits.slice(1)] : [commit, ...state.commits]
    },
    async commitAndPush(dir: string, message: string, o: { amend: boolean }) {
      await api.commit(dir, message, o)
      if (options.pushFails) throw new Error('El commit se creó, pero el push falló: rechazado')
      state.remoteCommits = state.commits.map(commit => commit.hash)
    },
    async load(root: string) {
      state.calls.push('load')
      return { root, commits: [...state.commits], changes: [...state.changes], ahead: state.commits.length - state.remoteCommits.length }
    },
  }
  return { api, state }
}

// Mirrors how the App wires things: refresh replaces the repo and re-resolves the selection.
function session(git: ReturnType<typeof fakeGit>) {
  const ui: { repo: any, selected: any, error: string } = { repo: null, selected: null, error: '' }
  const refresh = async () => { ui.error = ''; ui.repo = await git.api.load('/repo'); ui.selected = updatedSelection(ui.repo, ui.selected) }
  return { ui, refresh }
}

test('stage → commit → history refresh shows the new commit and an empty working tree', async () => {
  const git = fakeGit()
  const { ui, refresh } = session(git)
  await refresh()
  ui.selected = ui.repo.commits[0]

  assert.equal(await applyChange('/repo', root => git.api.stage(root, ['a.txt']), refresh), '')
  assert.equal(ui.repo.changes.find((change: any) => change.path === 'a.txt').status, 'A ')

  const outcome = await performCommit(git.api, '/repo', 'añade a.txt', { amend: false, push: false })
  assert.deepEqual(outcome, { committed: true, pushed: false })
  await refresh()

  assert.deepEqual(ui.repo.commits.map((commit: any) => commit.subject), ['añade a.txt', 'init'])
  assert.deepEqual(ui.repo.changes.map((change: any) => change.path), ['b.txt'])
  assert.equal(ui.selected.hash, 'c1', 'the previously selected commit stays selected')
  assert.deepEqual(git.state.calls, ['load', 'stage', 'load', 'commit', 'load'])
})

test('a failed stage still refreshes and reports the failure after the refresh', async () => {
  const git = fakeGit({ stageFails: true })
  const { ui, refresh } = session(git)
  await refresh()
  const failure = await applyChange('/repo', root => git.api.stage(root, ['a.txt']), refresh)
  assert.equal(failure, 'index.lock existe')
  assert.equal(ui.error, '', 'refresh cleared stale errors; the caller sets the failure afterwards')
  assert.deepEqual(git.state.calls, ['load', 'stage', 'load'])
})

test('commit and push publishes the commit', async () => {
  const git = fakeGit()
  const { ui, refresh } = session(git)
  await refresh()
  await applyChange('/repo', root => git.api.stage(root, ['b.txt']), refresh)
  const outcome = await performCommit(git.api, '/repo', 'fix b', { amend: false, push: true })
  assert.deepEqual(outcome, { committed: true, pushed: true })
  await refresh()
  assert.equal(ui.repo.ahead, 0)
})

test('push failure after a successful commit keeps the commit and surfaces the error', async () => {
  const git = fakeGit({ pushFails: true })
  const { ui, refresh } = session(git)
  await refresh()
  await applyChange('/repo', root => git.api.stage(root, ['b.txt']), refresh)
  const outcome = await performCommit(git.api, '/repo', 'fix b', { amend: false, push: true })
  assert.equal(outcome.committed, true)
  assert.equal(outcome.pushed, false)
  assert.match(outcome.error!, /push falló/)
  await refresh()
  assert.equal(ui.repo.commits[0].subject, 'fix b')
  assert.equal(ui.repo.ahead, 1)
})

test('a commit that fails entirely reports not committed', async () => {
  const git = fakeGit()
  const outcome = await performCommit(git.api, '/repo', 'nada', { amend: false, push: false })
  assert.deepEqual(outcome, { committed: false, pushed: false, error: 'nada que confirmar' })
  const pushed = await performCommit(git.api, '/repo', 'nada', { amend: false, push: true })
  assert.equal(pushed.committed, false, 'a push-mode failure without the "commit se creó" marker is a full failure')
})

test('amend replaces the last commit and the selection follows hashes, not positions', async () => {
  const git = fakeGit()
  const { ui, refresh } = session(git)
  await refresh()
  ui.selected = ui.repo.commits[0]
  await performCommit(git.api, '/repo', 'init (corregido)', { amend: true, push: false })
  await refresh()
  assert.deepEqual(ui.repo.commits.map((commit: any) => commit.subject), ['init (corregido)'])
  assert.equal(ui.selected, null, 'the amended commit has a new hash, so the old selection is dropped')
})

test('updatedSelection resolves stashes separately from commits', () => {
  const repo = { root: '/r', commits: [{ hash: 'a' }], stashes: [{ hash: 's' }] }
  assert.equal(updatedSelection(repo, { hash: 's', stash: 'stash@{0}' }), repo.stashes[0])
  assert.equal(updatedSelection(repo, { hash: 's' }), null)
  assert.equal(updatedSelection(repo, null), null)
})
