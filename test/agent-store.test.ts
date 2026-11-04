import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createAgentStore } from '../electron/agent-store.ts'
const tab = (id, count = 1) => ({ id, title: id, messages: Array.from({ length: count }, (_, i) => ({ role: 'user', text: String(i) })) })

test('conversations persist per repository across instances', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'git-graph-agent-')), 'chats.json')
  const store = createAgentStore(file)
  assert.deepEqual(await store.load('/a'), { tabs: [], activeId: null })
  await Promise.all([store.save('/a', { tabs: [tab('t1')], activeId: 't1' }), store.save('/b', { tabs: [tab('t2')], activeId: null })])
  const again = createAgentStore(file)
  assert.equal((await again.load('/a')).activeId, 't1')
  assert.equal((await again.load('/b')).tabs[0].id, 't2')
  await again.save('/a', { tabs: [] })
  assert.deepEqual(await createAgentStore(file).load('/a'), { tabs: [], activeId: null })
})

test('malformed tabs are dropped and sizes are bounded', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'git-graph-agent-')), 'chats.json')
  const store = createAgentStore(file)
  await store.save('/a', { tabs: [tab('big', 300), { id: 5, messages: [] }, null, ...Array.from({ length: 12 }, (_, i) => tab('x' + i))] })
  const saved = await store.load('/a')
  assert.equal(saved.tabs.length, 8)
  assert.equal(saved.tabs[0].messages.length, 100)
  await assert.rejects(store.save('', {}), /Repositorio/)
})

test('a corrupt file starts empty instead of failing', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'git-graph-agent-')), 'chats.json')
  await writeFile(file, '{not json')
  assert.deepEqual(await createAgentStore(file).load('/a'), { tabs: [], activeId: null })
})
