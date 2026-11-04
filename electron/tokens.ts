import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

// Identifies a repository (worktrees of the same repo share it) by its resolved git common dir.
async function repoKey(dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida')
  let common
  try { common = (await run('git', ['rev-parse', '--git-common-dir'], { cwd: dir, timeout: 15000, windowsHide: true })).stdout.trim() } catch { throw new Error('No es un repositorio de Git') }
  const resolved = await fs.realpath(path.resolve(dir, common)).catch(() => path.resolve(dir, common))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

// Stores one API token per repository outside settings.json. `crypt` ({ encrypt(text) -> Buffer, decrypt(Buffer) -> text }) is
// used when given (Electron's safeStorage); otherwise values are kept as plain text. The renderer only learns whether a token exists.
function createTokenStore(file, crypt?: { encrypt: (text: string) => Buffer; decrypt: (buffer: Buffer) => string }) {
  let state
  let queue = Promise.resolve()
  async function read() {
    if (state) return state
    try { state = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`No se pudieron leer los tokens: ${error.message}`)
      state = {}
    }
    return state
  }
  const decode = stored => {
    if (typeof stored !== 'string') return ''
    if (stored.startsWith('raw:')) return stored.slice(4)
    if (stored.startsWith('enc:') && crypt) { try { return crypt.decrypt(Buffer.from(stored.slice(4), 'base64')) } catch { return '' } }
    return ''
  }
  const encode = value => crypt ? 'enc:' + crypt.encrypt(value).toString('base64') : 'raw:' + value
  const assertKey = key => { if (typeof key !== 'string' || !key) throw new Error('Repositorio no válido') }
  return {
    async get(key) { assertKey(key); await queue; return decode((await read())[key]) },
    async has(key) { return Boolean(await this.get(key)) },
    set(key, value) {
      try { assertKey(key) } catch (error) { return Promise.reject(error) }
      if (typeof value !== 'string' || value.length > 1000 || /\s/.test(value.trim())) return Promise.reject(new Error('Token no válido'))
      const operation = queue.then(async () => {
        const next = { ...await read() }
        if (value.trim()) next[key] = encode(value.trim()); else delete next[key]
        await fs.mkdir(path.dirname(file), { recursive: true })
        const temporary = `${file}.${crypto.randomUUID()}.tmp`
        try { await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8'); await fs.rename(temporary, file) }
        catch (error) { await fs.unlink(temporary).catch(() => {}); throw new Error(`No se pudieron guardar los tokens: ${error.message}`) }
        state = next
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}
export { createTokenStore, repoKey }
