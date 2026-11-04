import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProjectStore } from '../electron/projects.ts'

test('default project survives activation and restart and is cleared on removal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-projects-test-'))
  const file = join(dir, 'projects.json')
  const store = createProjectStore(file)
  await store.add(join(dir, 'one'))
  await store.setDefault(join(dir, 'one'))
  await store.add(join(dir, 'two'))
  await store.activate(join(dir, 'one'), join(dir, 'worktree'))
  const restored = createProjectStore(file)
  assert.equal((await restored.list()).defaultProject, join(dir, 'one'))
  assert.equal((await restored.list()).projects.find(p => p.path === join(dir, 'one')).lastWorktree, join(dir, 'worktree'))
  await restored.remove(join(dir, 'one'))
  assert.equal(JSON.parse(await readFile(file, 'utf8')).defaultProject, null)
  await assert.rejects(restored.setDefault(join(dir, 'missing')), /ya no está/)
})

test('existing project lists without a default remain usable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-projects-legacy-'))
  const file = join(dir, 'projects.json')
  await writeFile(file, JSON.stringify({ projects: [{ path: dir, lastWorktree: dir }], activeProject: dir }))
  const store = createProjectStore(file)
  assert.equal((await store.list()).defaultProject, null)
  assert.equal((await store.setDefault(dir)).defaultProject, dir)
  assert.equal((await store.setDefault(null)).defaultProject, null)
})

test('folders organize projects across restarts without deleting or moving them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-projects-folders-'))
  const file = join(dir, 'projects.json')
  const project = join(dir, 'project')
  const store = createProjectStore(file)
  await store.add(project)
  const created = await store.createFolder('  Trabajo  ')
  assert.equal(created.folders[0].name, 'Trabajo')
  const id = created.folders[0].id
  await store.moveProject(project, id)
  await store.add(project)
  assert.equal((await store.list()).projects[0].folderId, id)
  await assert.rejects(store.createFolder('trabajo'), /Ya existe/)
  await assert.rejects(store.moveProject(project, 'missing'), /ya no existe/)
  await store.renameFolder(id, 'Personal')
  const restored = createProjectStore(file)
  assert.equal((await restored.list()).folders[0].name, 'Personal')
  assert.equal((await restored.list()).projects[0].folderId, id)
  const removed = await restored.deleteFolder(id)
  assert.equal(removed.folders.length, 0)
  assert.equal(removed.projects[0].folderId, null)
  assert.equal(removed.projects[0].path, project)
})

test('project order persists and invalid or stale lists cannot drop projects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-project-order-'))
  const file = join(dir, 'projects.json')
  const store = createProjectStore(file)
  const one = join(dir, 'one'), two = join(dir, 'two'), three = join(dir, 'three')
  await store.add(one); await store.add(two); await store.add(three)
  const folder = (await store.createFolder('Equipo')).folders[0]
  await store.moveProject(two, folder.id); await store.setDefault(one)
  await store.reorder([one, three, two])
  await store.add(three)
  const restored = await createProjectStore(file).list()
  assert.deepEqual(restored.projects.map(project => project.path), [one, three, two])
  assert.equal(restored.projects.find(project => project.path === two).folderId, folder.id)
  assert.equal(restored.defaultProject, one)
  await assert.rejects(store.reorder([one, one, two]), /cambiado/)
  await assert.rejects(store.reorder([one, two]), /no es válido/)
  assert.deepEqual((await store.list()).projects.map(project => project.path), [one, three, two])
})

test('each project keeps its own command through other project operations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-project-command-'))
  const file = join(dir, 'projects.json'), one = join(dir, 'one'), two = join(dir, 'two')
  const store = createProjectStore(file)
  await store.add(one); await store.add(two)
  await store.setCommand(one, 'code .'); await store.setCommand(two, 'orca open')
  await store.reorder([one, two]); await store.add(one)
  const restored = await createProjectStore(file).list()
  assert.equal(restored.projects.find(project => project.path === one).command, 'code .')
  assert.equal(restored.projects.find(project => project.path === two).command, 'orca open')
  await assert.rejects(store.setCommand(one, 'a\0b'), /no es válido/)
  await assert.rejects(store.setCommand(join(dir, 'missing'), 'code .'), /ya no está/)
  await store.setCommand(one, '')
  assert.equal((await store.list()).projects.find(project => project.path === one).command, '')
})
