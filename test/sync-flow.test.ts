import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshCachedProject, runSync } from '../src/lib/repo-flow.ts'

function api(info: any, fail: Partial<Record<'fetch' | 'pull' | 'push', string>> = {}) {
  const calls: string[] = []
  const step = (name: 'fetch' | 'pull' | 'push') => async () => { calls.push(name); if (fail[name]) throw new Error(fail[name]) }
  return { calls, fetch: step('fetch'), pull: step('pull'), push: step('push'), load: async () => { calls.push('load'); return { branch: 'main', sync: { main: info } } } }
}

test('sync pulls when behind and pushes when ahead, in that order', async () => {
  const git = api({ ahead: 1, behind: 2 })
  assert.deepEqual(await runSync(git, '/r', 'sync', true, 10), { notice: 'Sincronización completada' })
  assert.deepEqual(git.calls, ['fetch', 'load', 'pull', 'push'])
})

test('sync does nothing extra when up to date', async () => {
  const git = api({ ahead: 0, behind: 0 })
  await runSync(git, '/r', 'sync', true)
  assert.deepEqual(git.calls, ['fetch', 'load'])
})

test('sync aborts without pull or push when the upstream disappeared', async () => {
  for (const info of [undefined, { gone: true, ahead: 1, behind: 1 }]) {
    const git = api(info)
    const result = await runSync(git, '/r', 'sync', true)
    assert.match(result.failure!, /ya no está disponible/)
    assert.equal(result.notice, undefined)
    assert.deepEqual(git.calls, ['fetch', 'load'])
  }
})

test('sync stops at a failed pull and does not push', async () => {
  const git = api({ ahead: 1, behind: 1 }, { pull: 'no es avance rápido' })
  assert.deepEqual(await runSync(git, '/r', 'sync', true), { failure: 'no es avance rápido' })
  assert.deepEqual(git.calls, ['fetch', 'load', 'pull'])
})

test('single actions report their own notice or failure', async () => {
  assert.deepEqual(await runSync(api({}), '/r', 'push', true), { notice: 'Push completado' })
  assert.deepEqual(await runSync(api({}, { fetch: 'sin red' }), '/r', 'fetch', true), { failure: 'sin red' })
})

const cached = { repo: { root: '/r', commits: [1, 2, 3] } }

test('cached project refresh returns the reloaded repo and keeps the commit window', async () => {
  let limit = 0
  const git = { projects: { select: async () => {} }, load: async (_r: string, _s: boolean, l?: number) => { limit = l!; return { root: '/r', fresh: true } } }
  assert.deepEqual(await refreshCachedProject(git, '/r', cached, true, () => true), { repo: { root: '/r', fresh: true } })
  assert.equal(limit, 3)
})

test('a superseded refresh is discarded entirely', async () => {
  let request = 1
  const git = { projects: { select: async () => {} }, load: async () => { request = 2; return { fresh: true } } }
  assert.equal(await refreshCachedProject(git, '/r', cached, true, () => request === 1), null)
})

test('selection and reload failures are reported independently', async () => {
  const bad = { projects: { select: async () => { throw new Error('disco lleno') } }, load: async () => { throw new Error('repo roto') } }
  assert.deepEqual(await refreshCachedProject(bad, '/r', cached, true, () => true), {
    selectionError: 'No se pudo guardar la selección: disco lleno',
    refreshError: 'No se pudo actualizar «/r»: repo roto',
  })
})
