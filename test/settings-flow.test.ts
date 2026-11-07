import test from 'node:test'
import assert from 'node:assert/strict'
import { applySetting } from '../src/settings-flow.ts'

function cell(initial: unknown) {
  const box = { value: initial, history: [initial] as unknown[] }
  return { box, access: { get value() { return box.value }, set: (v: unknown) => { box.value = v; box.history.push(v) } } }
}
const deferred = () => { let resolve!: () => void, reject!: (e: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('a saved setting stays applied and reports no error', async () => {
  const { box, access } = cell(false)
  assert.equal(await applySetting({}, 'leftOpen', access, true, async () => {}), null)
  assert.equal(box.value, true)
})

test('the new value is visible before persisting finishes', async () => {
  const { box, access } = cell(1)
  const save = deferred()
  const pending = applySetting({}, 'tabLabelWidth', access, 2, () => save.promise)
  assert.equal(box.value, 2)
  save.resolve()
  await pending
})

test('a failed save rolls back to the previous value and returns the message', async () => {
  const { box, access } = cell('dark')
  const error = await applySetting({}, 'theme', access, 'light', async () => { throw new Error('disco lleno') })
  assert.equal(error, 'disco lleno')
  assert.equal(box.value, 'dark')
  assert.deepEqual(box.history, ['dark', 'light', 'dark'])
})

test('a slow failure does not undo a newer change to the same key', async () => {
  const { box, access } = cell(0)
  const versions = {}
  const first = deferred()
  const slow = applySetting(versions, 'autoFetchMinutes', access, 5, () => first.promise)
  await applySetting(versions, 'autoFetchMinutes', access, 10, async () => {})
  first.reject(new Error('timeout'))
  assert.equal(await slow, 'timeout', 'the error is still reported')
  assert.equal(box.value, 10, 'but the newer value is kept')
})

test('versions are tracked per key', async () => {
  const left = cell(true), right = cell(true)
  const versions = {}
  const slow = deferred()
  const first = applySetting(versions, 'leftOpen', left.access, false, () => slow.promise)
  await applySetting(versions, 'rightOpen', right.access, false, async () => {})
  slow.reject(new Error('fallo'))
  await first
  assert.equal(left.box.value, true, 'leftOpen rolled back: nothing newer touched it')
  assert.equal(right.box.value, false)
})

test('a failure in the follow-up reload also rolls back, as the persist step includes it', async () => {
  const { box, access } = cell(true)
  const error = await applySetting({}, 'showRemote', access, false, async () => { await Promise.resolve(); throw new Error('recarga fallida') })
  assert.equal(error, 'recarga fallida')
  assert.equal(box.value, true)
})
