import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAndReload, type LatestState } from '../src/repo-flow.ts'

const state = (over: Partial<LatestState> = {}): LatestState => ({ repo: { root: '/r', commits: [1, 2, 3] }, busy: false, showRemote: true, activeProject: '/r', ...over })

function api(onFetch: () => void = () => {}, onLoad: () => void = () => {}) {
  const calls: string[] = []
  return { calls, fetch: async () => { calls.push('fetch'); onFetch() }, load: async (_r: string, remote: boolean, limit?: number) => { calls.push(`load:${remote}:${limit}`); onLoad(); return { fresh: true } } }
}

test('fetches, then reloads keeping the loaded commit window', async () => {
  const git = api()
  const result = await fetchAndReload(git, '/r', () => state(), () => 1)
  assert.deepEqual(result, { data: { fresh: true }, state: state() })
  assert.deepEqual(git.calls, ['fetch', 'load:true:3'])
})

test('discards the result when the user became busy during the fetch', async () => {
  let current = state()
  const git = api(() => { current = state({ busy: true }) })
  assert.equal(await fetchAndReload(git, '/r', () => current, () => 1), null)
  assert.deepEqual(git.calls, ['fetch'], 'no reload is attempted')
})

test('discards the result when another project was opened during the reload', async () => {
  let current = state()
  const git = api(undefined, () => { current = state({ repo: { root: '/other', commits: [] } }) })
  assert.equal(await fetchAndReload(git, '/r', () => current, () => 1), null)
})

test('discards the result when a newer request started', async () => {
  let request = 1
  const git = api(() => { request = 2 })
  assert.equal(await fetchAndReload(git, '/r', () => state(), () => request), null)
  assert.deepEqual(git.calls, ['fetch'])
})

test('uses the showRemote value current after the fetch, not the one at the start', async () => {
  let current = state()
  const git = api(() => { current = state({ showRemote: false }) })
  await fetchAndReload(git, '/r', () => current, () => 1)
  assert.deepEqual(git.calls, ['fetch', 'load:false:3'])
})

test('fetch errors propagate so the caller decides whether to report them', async () => {
  const failing = { fetch: async () => { throw new Error('sin red') }, load: async () => ({}) }
  await assert.rejects(fetchAndReload(failing, '/r', () => state(), () => 1), /sin red/)
})
