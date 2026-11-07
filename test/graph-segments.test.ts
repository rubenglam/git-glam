import test from 'node:test'
import assert from 'node:assert/strict'
import { graphSegments } from '../src/lib/graph-segments.ts'

test('a new merge lane starts at the commit without an isolated vertical segment', () => {
  const segments = graphSegments({ col: 0, hasIncoming: true, before: ['merge'], after: ['first', 'second'], joins: [], forks: [1] })
  assert.deepEqual(segments.map(s => s.d), ['M17 0 V14', 'M17 14 V28', 'M17 14 C17 21 35 21 35 28'])
})

test('a joining lane curves into the commit without a dangling straight segment', () => {
  const segments = graphSegments({ col: 0, hasIncoming: true, before: ['parent', 'parent'], after: ['root', null], joins: [1], forks: [] })
  assert.deepEqual(segments.map(s => s.d), ['M17 0 V14', 'M35 0 C35 7 17 7 17 14', 'M17 14 V28'])
})

test('a merge into an existing lane preserves its continuous line and adds a connection', () => {
  const segments = graphSegments({ col: 0, hasIncoming: true, before: ['merge', 'other'], after: ['first', 'other'], joins: [], forks: [1] })
  assert.deepEqual(segments.map(s => s.d), ['M35 0 V28', 'M17 0 V14', 'M17 14 V28', 'M17 14 C17 21 35 21 35 28'])
})

test('compact rows connect at their edges and center', () => {
  const segments = graphSegments({ col: 0, hasIncoming: true, before: ['merge', 'other'], after: ['first', 'other'], joins: [], forks: [1] }, 22)
  assert.deepEqual(segments.map(s => s.d), ['M35 0 V22', 'M17 0 V11', 'M17 11 V22', 'M17 11 C17 16.5 35 16.5 35 22'])
})
