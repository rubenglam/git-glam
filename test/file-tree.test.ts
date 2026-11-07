import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFileTree } from '../src/lib/file-tree.ts'

const file = (path, added = 1, deleted = 0) => ({ path, added, deleted, binary: false })

test('merges single-child folder chains and separates branches', () => {
  const tree = buildFileTree([file('apps/frontend/src/a/x.tsx'), file('apps/frontend/src/b/y.ts')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, 'apps / frontend / src')
  assert.deepEqual(tree[0].children.map(node => node.label), ['a', 'b'])
  assert.equal(tree[0].children[0].children[0].name, 'x.tsx')
})

test('lists folders before files at the root', () => {
  const tree = buildFileTree([file('README.md'), file('src/a.ts')])
  assert.deepEqual(tree.map(node => node.type), ['dir', 'file'])
})
