import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_TABS = 8
const MAX_MESSAGES = 100

// Keeps only well-formed conversations and bounds their size so a bad payload can't bloat the file.
function clean(data) {
  const tabs = (Array.isArray(data?.tabs) ? data.tabs : []).filter(tab => tab && typeof tab.id === 'string' && Array.isArray(tab.messages)).slice(0, MAX_TABS).map(tab => ({ ...tab, messages: tab.messages.slice(-MAX_MESSAGES) }))
  return { tabs, activeId: typeof data?.activeId === 'string' ? data.activeId : null }
}

// Agent conversations per repository, persisted so they survive closing the dialog or the app.
function createAgentStore(file) {
  let state
  let queue = Promise.resolve()
  async function read() {
    if (state) return state
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      state = saved && typeof saved.chats === 'object' && !Array.isArray(saved.chats) ? saved : { chats: {} }
    } catch { state = { chats: {} } }
    return state
  }
  const load = async root => { await queue; return (await read()).chats[root] ?? { tabs: [], activeId: null } }
  function save(root, data) {
    if (typeof root !== 'string' || !root) return Promise.reject(new Error('Repositorio no válido'))
    const operation = queue.then(async () => {
      const chats = { ...(await read()).chats }, next = clean(data)
      if (next.tabs.length) chats[root] = next; else delete chats[root]
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try { await fs.writeFile(temporary, JSON.stringify({ chats }), 'utf8'); await fs.rename(temporary, file) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw new Error(`No se pudieron guardar las conversaciones: ${error.message}`) }
      state = { chats }
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { load, save }
}

export { createAgentStore }
