import test from 'node:test'
import assert from 'node:assert/strict'
import { applyElectronUi } from '../src/bridge/tauri-bridge.ts'

test('imports absent and default UI preferences without replacing custom values', () => {
  const values = new Map([['gitgraph.hiddenTabs', '[]'], ['gitgraph.leftWidth', '410']])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
  applyElectronUi({ 'gitgraph.hiddenTabs': '["repo"]', 'gitgraph.leftWidth': '300', 'gitgraph.rightWidth': '290' }, storage)
  assert.equal(values.get('gitgraph.hiddenTabs'), '["repo"]')
  assert.equal(values.get('gitgraph.leftWidth'), '410')
  assert.equal(values.get('gitgraph.rightWidth'), '290')
})
