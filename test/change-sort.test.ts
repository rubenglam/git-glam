import test from 'node:test'
import assert from 'node:assert/strict'
import { sortChanges, statusLetter } from '../src/change-sort.ts'

const changes = [{ status: ' M', path: 'src/b.js' }, { status: '??', path: 'a/z.js' }, { status: ' D', path: 'src/a.js' }, { status: 'M ', path: 'lib/c.js' }]

test('sorts by path, name or status', () => {
  assert.deepEqual(sortChanges(changes, 'path', false).map(c => c.path), ['a/z.js', 'lib/c.js', 'src/a.js', 'src/b.js'])
  assert.deepEqual(sortChanges(changes, 'name', false).map(c => c.path), ['src/a.js', 'src/b.js', 'lib/c.js', 'a/z.js'])
  assert.deepEqual(sortChanges(changes, 'status', false).map(c => statusLetter(c, false)), [' ', 'D', 'M', 'U'])
})

test('status letter depends on the area', () => {
  assert.equal(statusLetter({ status: 'MM', path: 'x' }, true), 'M')
  assert.equal(statusLetter({ status: 'A ', path: 'x' }, true), 'A')
  assert.equal(statusLetter({ status: '??', path: 'x' }, false), 'U')
})
