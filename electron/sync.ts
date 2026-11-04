import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

async function git(cwd, args) {
  try {
    return (await run('git', args, { cwd, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
  } catch (error) {
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}
const assertDir = dir => { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }

// Parses `for-each-ref --format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)` output.
function parseTracking(text) {
  const names: string[] = [], sync: Record<string, { upstream: string; ahead: number; behind: number; gone: boolean }> = {}
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const [name, upstream = '', track = ''] = line.split('\x1f')
    names.push(name)
    if (!upstream) continue
    sync[name] = { upstream, ahead: Number(/ahead (\d+)/.exec(track)?.[1] || 0), behind: Number(/behind (\d+)/.exec(track)?.[1] || 0), gone: track === 'gone' }
  }
  return { names, sync }
}

async function currentBranch(dir) {
  const branch = (await git(dir, ['branch', '--show-current'])).trim()
  if (!branch) throw new Error('No hay ninguna rama activa (HEAD separado)')
  return branch
}

async function fetchRepo(dir) {
  assertDir(dir)
  await git(dir, ['fetch', '--all', '--prune', '--quiet'])
}

async function pullRepo(dir) {
  assertDir(dir)
  await currentBranch(dir)
  await git(dir, ['pull', '--ff-only'])
}

async function pushRepo(dir) {
  assertDir(dir)
  const branch = await currentBranch(dir)
  const upstream = (await git(dir, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]).catch(() => '')).trim()
  if (upstream) { await git(dir, ['push']); return }
  const remotes = (await git(dir, ['remote'])).split(/\r?\n/).filter(Boolean)
  if (!remotes.length) throw new Error('El repositorio no tiene remotos configurados')
  await git(dir, ['push', '--set-upstream', remotes.includes('origin') ? 'origin' : remotes[0], branch])
}

export { parseTracking, fetchRepo, pullRepo, pushRepo }
