import test from 'node:test'
import assert from 'node:assert/strict'

import { parseNumstat } from '../electron/commit-files.ts'

test('parses added and deleted counts per file', () => {
  assert.deepEqual(parseNumstat('2\t1\tapps/a.tsx\0'), [{ path: 'apps/a.tsx', added: 2, deleted: 1, binary: false }])
})

test('marks binary files and keeps paths with spaces', () => {
  assert.deepEqual(parseNumstat('-\t-\tlogo final.png\x000\t9\tb.ts\0'), [
    { path: 'logo final.png', added: 0, deleted: 0, binary: true },
    { path: 'b.ts', added: 0, deleted: 9, binary: false },
  ])
})

test('returns an empty list for commits without changes', () => {
  assert.deepEqual(parseNumstat(''), [])
})
