import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_ITEMS = 200
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''

// Keeps only well-formed improvements and bounds their size so a bad payload can't bloat the file.
function clean(data) {
  return (Array.isArray(data) ? data : []).filter(item => item && typeof item.id === 'string' && typeof item.title === 'string').slice(-MAX_ITEMS).map(item => ({
    id: text(item.id, 64), title: text(item.title, 200), description: text(item.description, 2000), effort: text(item.effort, 30),
    files: (Array.isArray(item.files) ? item.files : []).slice(0, 20).map(file => text(file, 300)),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  }))
}

// Saved improvement ideas per repository, persisted so they can be reviewed later.
function createImprovementsStore(file) {
  let state
  let queue = Promise.resolve()
  async function read() {
    if (state) return state
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      state = saved && typeof saved.items === 'object' && !Array.isArray(saved.items) ? saved : { items: {} }
    } catch { state = { items: {} } }
    return state
  }
  const load = async root => { await queue; return (await read()).items[root] ?? [] }
  function save(root, data) {
    if (typeof root !== 'string' || !root) return Promise.reject(new Error('Repositorio no válido'))
    const operation = queue.then(async () => {
      const items = { ...(await read()).items }, next = clean(data)
      if (next.length) items[root] = next; else delete items[root]
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try { await fs.writeFile(temporary, JSON.stringify({ items }), 'utf8'); await fs.rename(temporary, file) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw new Error(`No se pudieron guardar las mejoras: ${error.message}`) }
      state = { items }
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { load, save }
}

export { createImprovementsStore }
