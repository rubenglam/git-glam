import fs from 'node:fs/promises'
import path from 'node:path'
import { MODELS, EFFORTS } from './agent-chat.ts'
import crypto from 'node:crypto'

const defaults = { showRemote: true, leftOpen: true, rightOpen: true, groupTabs: false, showUngroupedLabel: false, tabLabelWidth: 220, autoFetchMinutes: 0, agentModel: 'claude-sonnet-5-5', agentEffort: 'medium' }
const valid = (key, value) => key === 'agentModel' ? MODELS.includes(value) : key === 'agentEffort' ? EFFORTS.includes(value) : key === 'tabLabelWidth' ? Number.isInteger(value) && value >= 80 && value <= 400 : key === 'autoFetchMinutes' ? Number.isInteger(value) && value >= 0 && value <= 120 : typeof value === 'boolean'

function createSettingsStore(file) {
  let state
  let queue = Promise.resolve()
  async function read() {
    if (state) return state
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(defaults).some(key => saved[key] !== undefined && !valid(key, saved[key]))) throw new Error('Formato de ajustes no válido')
      state = Object.fromEntries(Object.keys(defaults).map(key => [key, saved[key] ?? defaults[key]]))
    } catch (error) {
      if (error.code === 'ENOENT') state = { ...defaults }
      else throw new Error(`No se pudieron leer los ajustes: ${error.message}`)
    }
    return state
  }
  function set(key, value) {
    if (!Object.hasOwn(defaults, key) || !valid(key, value)) return Promise.reject(new Error('Ajuste no válido'))
    const operation = queue.then(async () => {
      const next = { ...await read(), [key]: value }
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try { await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8'); await fs.rename(temporary, file) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw new Error(`No se pudieron guardar los ajustes: ${error.message}`) }
      state = next
      return next
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { read: async () => { await queue; return read() }, set }
}
export { createSettingsStore }
