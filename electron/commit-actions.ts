import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

async function git(cwd, args) {
  try {
    return await run('git', ['-c', 'core.editor=true', '-c', 'sequence.editor=true', ...args], {
      cwd, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' },
    })
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    throw new Error(output || error.message)
  }
}

async function runCommitAction(repo, request) {
  if (typeof repo !== 'string' || !request || typeof request !== 'object' || typeof request.hash !== 'string' || !HASH.test(request.hash)) throw new Error('Repositorio o commit no válido')
  const { type, hash } = request
  const permitted = ['tag', 'branch', 'checkout', 'cherry-pick', 'revert', 'merge', 'rebase', 'reset']
  if (!permitted.includes(type)) throw new Error('Acción no válida')
  await git(repo, ['cat-file', '-e', `${hash}^{commit}`])
  if (!['tag', 'branch'].includes(type)) {
    if (!HASH.test(request.expectedHead || '') || typeof request.expectedBranch !== 'string') throw new Error('Falta el estado esperado de HEAD')
    const head = (await git(repo, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()
    const branch = (await git(repo, ['branch', '--show-current'])).stdout.trim() || 'HEAD separado'
    if (head.toLowerCase() !== request.expectedHead.toLowerCase() || branch !== request.expectedBranch) throw new Error('HEAD o la rama actual han cambiado. Actualiza el grafo y vuelve a intentarlo.')
    if (['merge', 'rebase', 'reset'].includes(type) && branch === 'HEAD separado') throw new Error('Esta acción requiere una rama activa; HEAD está separado.')
  }
  let args
  if (type === 'tag' || type === 'branch') {
    if (typeof request.name !== 'string' || !request.name || request.name.startsWith('-') || request.name.trim() !== request.name) throw new Error('Introduce un nombre válido')
    await git(repo, ['check-ref-format', type === 'tag' ? `refs/tags/${request.name}` : `refs/heads/${request.name}`])
    const message = type === 'tag' && typeof request.message === 'string' ? request.message.trim() : ''
    args = type === 'tag' ? (message ? ['tag', '-a', '-m', message, '--', request.name, hash] : ['tag', '--', request.name, hash]) : ['branch', '--', request.name, hash]
  } else if (type === 'checkout') args = ['checkout', '--detach', hash]
  else if (type === 'cherry-pick' || type === 'revert') {
    const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', hash])).stdout.trim().split(/\s+/).slice(1)
    const mainline = request.mainline
    if (parents.length > 1 && (!Number.isInteger(mainline) || mainline < 1 || mainline > parents.length)) throw new Error('Selecciona el padre principal del merge')
    args = [type, '--no-edit', ...(parents.length > 1 ? ['-m', String(mainline)] : []), hash]
  } else if (type === 'merge') args = ['merge', '--no-edit', hash]
  else if (type === 'rebase') args = ['rebase', '--no-autostash', hash]
  else {
    if (!['soft', 'mixed', 'hard'].includes(request.mode)) throw new Error('Modo de reset no válido')
    args = ['reset', `--${request.mode}`, hash]
  }
  const result = await git(repo, args)
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
}
export { runCommitAction }
