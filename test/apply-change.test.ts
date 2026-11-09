import test from 'node:test'
import assert from 'node:assert/strict'
import { applyChange } from '../src/lib/repo-flow.ts'

test('a change refreshes the repo when no watcher will do it', async () => {
  const calls: string[] = []
  const failure = await applyChange('/r', async () => { calls.push('task') }, async () => { calls.push('refresh') })
  assert.equal(failure, '')
  assert.deepEqual(calls, ['task', 'refresh'])
})

test('a change skips the explicit refresh when the watcher is active', async () => {
  const calls: string[] = []
  await applyChange('/r', async () => { calls.push('task') }, async () => { calls.push('refresh') }, true)
  assert.deepEqual(calls, ['task'])
})

test('a failed change still refreshes even when the watcher is active, and reports the failure', async () => {
  const calls: string[] = []
  const failure = await applyChange('/r', async () => { throw new Error('index.lock') }, async () => { calls.push('refresh') }, true)
  assert.equal(failure, 'index.lock')
  assert.deepEqual(calls, ['refresh'])
})
