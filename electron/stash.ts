import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const HASH = /^[a-f0-9]{40,64}$/i

async function git(cwd, args) {
  try {
    return (await run('git', args, { cwd, timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
  } catch (error) {
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}
const assertDir = dir => { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }

async function stashPush(dir, { message = '', includeUntracked = false, keepIndex = false } = {}) {
  assertDir(dir)
  const text = typeof message === 'string' ? message.trim() : ''
  const before = (await git(dir, ['rev-parse', '-q', '--verify', 'refs/stash']).catch(() => '')).trim()
  await git(dir, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(keepIndex ? ['--keep-index'] : []), ...(text ? ['-m', text] : [])])
  const after = (await git(dir, ['rev-parse', '-q', '--verify', 'refs/stash']).catch(() => '')).trim()
  if (before === after) throw new Error('No hay cambios locales que guardar')
}

// The renderer names a stash by its commit hash; the index is looked up fresh because stash@{n} shifts after any drop/pop.
async function resolve(dir, hash) {
  assertDir(dir)
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Stash no válido')
  const list = (await git(dir, ['stash', 'list', '--format=%H'])).split(/\r?\n/).filter(Boolean)
  const index = list.findIndex(item => item.toLowerCase() === hash.toLowerCase())
  if (index < 0) throw new Error('El stash ya no existe. Actualiza la lista.')
  return `stash@{${index}}`
}

const stashApply = async (dir, hash) => { await git(dir, ['stash', 'apply', '--index', await resolve(dir, hash)]) }
const stashPop = async (dir, hash) => { await git(dir, ['stash', 'pop', '--index', await resolve(dir, hash)]) }
const stashDrop = async (dir, hash) => { await git(dir, ['stash', 'drop', await resolve(dir, hash)]) }

// Untracked files live in the stash commit's third parent; `show --first-parent` alone never lists them.
async function untrackedParent(dir, hash) {
  const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', hash])).trim().split(/\s+/).slice(1)
  return parents.length >= 3 ? parents[2] : null
}

// Extra `git show` output (patch or numstat) for the untracked files of a stash; empty for ordinary commits.
async function stashExtras(dir, hash, args) {
  if (typeof dir !== 'string' || !HASH.test(hash)) throw new Error('Commit no válido')
  const untracked = await untrackedParent(dir, hash).catch(() => null)
  return untracked ? git(dir, ['-c', 'core.quotepath=false', 'show', '--format=', '--no-ext-diff', '--no-textconv', ...args, untracked, '--']) : ''
}

export { stashPush, stashApply, stashPop, stashDrop, stashExtras }
