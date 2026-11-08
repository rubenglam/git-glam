import test from 'node:test'
import assert from 'node:assert/strict'
import { extendLayout, layout, orderHistory, type LayoutState } from '../src/lib/graph-layout.ts'

interface Node { hash: string, parents: string[] }

// Topologically ordered history with branches and merges, newest first.
const history: Node[] = [
  { hash: 'm2', parents: ['m1', 'f3'] },
  { hash: 'f3', parents: ['f2'] },
  { hash: 'm1', parents: ['b3', 'f2'] },
  { hash: 'f2', parents: ['f1'] },
  { hash: 'b3', parents: ['b2'] },
  { hash: 'f1', parents: ['b1'] },
  { hash: 'b2', parents: ['b1'] },
  { hash: 'b1', parents: ['root'] },
  { hash: 'root', parents: [] },
]

test('appending pages gives the same graph as laying out everything at once', () => {
  const expected = layout(orderHistory(history))
  for (const size of [1, 2, 3, 4]) {
    let state: LayoutState<Node> | null = null
    for (let end = size; ; end = Math.min(end + size, history.length)) {
      state = extendLayout(state, history.slice(0, end))
      if (end === history.length) break
    }
    assert.deepEqual(state?.rows, expected, `page size ${size}`)
  }
})

test('appending pages reuses the previous rows and does not mutate them', () => {
  const first = extendLayout(null, history.slice(0, 4))
  const snapshot = structuredClone(first.rows)
  const lanes = first.lanes.slice()
  const next = extendLayout(first, history.slice(0, 6))
  assert.deepEqual(first.rows, snapshot)
  assert.deepEqual(first.lanes, lanes)
  assert.equal(next.rows[0], first.rows[0])
  assert.equal(extendLayout(next, history.slice(0, 6)), next)
})

test('commits that are not an extension of the previous list are laid out from scratch', () => {
  const first = extendLayout(null, history.slice(0, 4))
  const reloaded = history.slice(0, 6).map(commit => ({ ...commit }))
  const next = extendLayout(first, reloaded)
  assert.deepEqual(next.rows.map(row => row.commit.hash), reloaded.map(commit => commit.hash))
  assert.deepEqual(next.rows, layout(orderHistory(reloaded)))
  assert.notEqual(next.rows[0], first.rows[0])
})
