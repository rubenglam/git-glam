import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

import { createSettingsStore } from '../electron/settings.ts'

test('settings use defaults, serialize updates and persist across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-settings-'))
  const file = join(dir, 'settings.json')
  const store = createSettingsStore(file)
  assert.deepEqual(await store.read(), { showRemote: true, leftOpen: true, rightOpen: true, groupTabs: false, showUngroupedLabel: false, tabLabelWidth: 220, autoFetchMinutes: 0, layoutDensity: 'comfortable', theme: 'dark', agentModel: 'claude-sonnet-5-5', agentEffort: 'medium' })
  await Promise.all([store.set('showRemote', false), store.set('leftOpen', false), store.set('groupTabs', true), store.set('tabLabelWidth', 300), store.set('autoFetchMinutes', 5), store.set('theme', 'light'), store.set('agentModel', 'claude-opus-5-5'), store.set('agentEffort', 'high')])
  assert.deepEqual(await createSettingsStore(file).read(), { showRemote: false, leftOpen: false, rightOpen: true, groupTabs: true, showUngroupedLabel: false, tabLabelWidth: 300, autoFetchMinutes: 5, layoutDensity: 'comfortable', theme: 'light', agentModel: 'claude-opus-5-5', agentEffort: 'high' })
  await assert.rejects(store.set('autoFetchMinutes', 500), /Ajuste no válido/)
  await assert.rejects(store.set('theme', 'blue'), /Ajuste no válido/)
  await assert.rejects(store.set('agentModel', 'gpt-4'), /Ajuste no válido/)
  await assert.rejects(store.set('agentEffort', 'extreme'), /Ajuste no válido/)
  await assert.rejects(store.set('other', true), /Ajuste no válido/)
  await assert.rejects(store.set('tabLabelWidth', 10), /Ajuste no válido/)
  await assert.rejects(store.set('showRemote', 'false'), /Ajuste no válido/)
})

test('invalid settings are reported without overwriting the existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-settings-invalid-'))
  const file = join(dir, 'settings.json')
  await writeFile(file, '{"showRemote":"invalid"}')
  const store = createSettingsStore(file)
  await assert.rejects(store.read(), /No se pudieron leer/)
  await assert.rejects(store.set('showRemote', true), /No se pudieron leer/)
  assert.equal(await readFile(file, 'utf8'), '{"showRemote":"invalid"}')
})
