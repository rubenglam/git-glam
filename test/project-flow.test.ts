import test from 'node:test'
import assert from 'node:assert/strict'
import { isTabHidden, mergeVisibleOrder, moveTabFlow, openUncachedProject, revealProject } from '../src/project-flow.ts'

const p = (path: string, folderId?: string) => ({ path, folderId })

test('hidden tabs: by path, or by folder only while tabs are grouped', () => {
  assert.equal(isTabHidden(p('a'), ['a'], [], false), true)
  assert.equal(isTabHidden(p('b', 'f'), [], ['f'], true), true)
  assert.equal(isTabHidden(p('b', 'f'), [], ['f'], false), false, 'folder hiding ignored when ungrouped')
  assert.equal(isTabHidden(p('c'), [], ['f'], true), false, 'a project without a folder is never folder-hidden')
})

test('reordering visible tabs keeps hidden projects in their slots', () => {
  const all = [p('a'), p('h1'), p('b'), p('h2'), p('c')]
  const hidden = (project: { path: string }) => project.path.startsWith('h')
  const next = mergeVisibleOrder(all, [p('c'), p('a'), p('b')], hidden)
  assert.deepEqual(next.map(x => x.path), ['c', 'h1', 'a', 'h2', 'b'])
})

test('revealing the active project unhides its tab and its folder, leaving others hidden', () => {
  assert.deepEqual(revealProject(p('a', 'f'), ['a', 'z'], ['f', 'g']), { hiddenTabs: ['z'], hiddenFolders: ['g'] })
  const same = ['z']
  assert.equal(revealProject(p('a'), same, []).hiddenTabs, same, 'untouched lists keep their identity (no needless re-render)')
})

test('moving a tab across folders then reordering sends the final order', async () => {
  const calls: string[] = []
  const api = {
    move: async (path: string, folderId: string | null) => { calls.push(`move ${path}->${folderId}`); return { projects: [p('a'), p('b', 'f'), p('c', 'f')] } },
    reorder: async (paths: string[]) => { calls.push('reorder ' + paths.join(',')); return { projects: paths.map(x => p(x)) } },
  }
  const state = await moveTabFlow(api, 'a', 'f', 'c', 'before')
  assert.deepEqual(calls, ['move a->f', 'reorder b,a,c'])
  assert.deepEqual(state.projects.map(x => x.path), ['b', 'a', 'c'])
})

test('moving a tab without a target skips the reorder', async () => {
  let reordered = false
  const api = { move: async () => ({ projects: [p('a')] }), reorder: async () => { reordered = true; return { projects: [] } } }
  await moveTabFlow(api, 'a', null, null, 'after')
  assert.equal(reordered, false)
})

test('a failing move never reorders', async () => {
  let reordered = false
  const api = { move: async () => { throw new Error('carpeta inexistente') }, reorder: async () => { reordered = true; return { projects: [] } } }
  await assert.rejects(moveTabFlow(api, 'a', 'x', 'b', 'after'), /carpeta inexistente/)
  assert.equal(reordered, false)
})

const opened = { repo: { root: '/r' }, state: { projects: [], activeProject: '/r' } }

test('opening an uncached project returns the result', async () => {
  assert.deepEqual(await openUncachedProject({ open: async () => opened }, '/r', true, () => true), { result: opened })
})

test('opening failure is reported with the project path', async () => {
  const outcome = await openUncachedProject({ open: async () => { throw new Error('no es un repositorio') } }, '/r', true, () => true)
  assert.deepEqual(outcome, { error: 'No se pudo abrir el proyecto «/r»: no es un repositorio' })
})

test('a superseded open is ignored, whether it succeeds or fails', async () => {
  assert.equal(await openUncachedProject({ open: async () => opened }, '/r', true, () => false), null)
  assert.equal(await openUncachedProject({ open: async () => { throw new Error('x') } }, '/r', true, () => false), null)
})

test('the stale check runs after the request finishes, not before', async () => {
  let request = 1
  const outcome = await openUncachedProject({ open: async () => { request = 2; return opened } }, '/r', true, () => request === 1)
  assert.equal(outcome, null)
})
