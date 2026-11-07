import test from 'node:test'
import assert from 'node:assert/strict'
import { moveProjectTab } from '../src/lib/project-order.ts'

test('tabs can move in either direction without losing project data', () => {
  const projects = [{ path: 'a' }, { path: 'b', folderId: 'x' }, { path: 'c' }]
  assert.deepEqual(moveProjectTab(projects, 'a', 'c', 'after').map(project => project.path), ['b', 'c', 'a'])
  assert.deepEqual(moveProjectTab(projects, 'c', 'a', 'before').map(project => project.path), ['c', 'a', 'b'])
  assert.equal(moveProjectTab(projects, 'a', 'a', 'before'), projects)
  assert.equal(moveProjectTab(projects, 'missing', 'a', 'before'), projects)
  assert.equal(projects[1].folderId, 'x')
})
