import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { pushRepo } from './sync.ts'
const run = promisify(execFile)
const MAX_DIFF = 12000

async function git(cwd, args) {
  try {
    return (await run('git', args, { cwd, timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
  } catch (error) {
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}
const exists = (cwd, ref) => git(cwd, ['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false)
const assertDir = dir => { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }

async function listBranches(dir) {
  assertDir(dir)
  const [current, text] = await Promise.all([
    git(dir, ['branch', '--show-current']),
    git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)%1f%(committerdate:relative)%1f%(authorname)%1f%(objectname:short)%1f%(subject)', 'refs/heads', 'refs/remotes']),
  ])
  const all = text.split(/\r?\n/).filter(Boolean).map(line => {
    const [ref, name, date, author, hash, subject] = line.split('\x1f')
    return { ref, name, remote: ref.startsWith('refs/remotes/'), date, author, hash, subject }
  }).filter(branch => !branch.ref.endsWith('/HEAD'))
  const local = new Set(all.filter(branch => !branch.remote).map(branch => branch.name))
  const branches = all.filter(branch => !branch.remote || !local.has(branch.name.slice(branch.name.indexOf('/') + 1)))
  return { current: current.trim(), branches }
}

async function switchBranch(dir, ref) {
  assertDir(dir)
  const match = typeof ref === 'string' && /^refs\/(heads|remotes)\/(.+)$/.exec(ref)
  if (!match || match[2].startsWith('-') || !await exists(dir, ref)) throw new Error('Rama no válida')
  if (match[1] === 'heads') await git(dir, ['switch', match[2]])
  else {
    const local = match[2].slice(match[2].indexOf('/') + 1)
    if (await exists(dir, `refs/heads/${local}`)) await git(dir, ['switch', local])
    else await git(dir, ['switch', '--track', match[2]])
  }
}

async function createBranch(dir, name) {
  assertDir(dir)
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.trim() !== name) throw new Error('Introduce un nombre de rama válido')
  await git(dir, ['check-ref-format', '--branch', name]).catch(() => { throw new Error('Nombre de rama no válido') })
  if (await exists(dir, `refs/heads/${name}`)) throw new Error(`La rama «${name}» ya existe`)
  await git(dir, ['switch', '-c', name])
}

async function hasStaged(dir) {
  return (await git(dir, ['diff', '--cached', '--name-only', '-z'])).length > 0
}

async function commitChanges(dir, message, { amend = false } = {}) {
  assertDir(dir)
  const text = typeof message === 'string' ? message.trim() : ''
  if (amend) {
    if (!await exists(dir, 'HEAD')) throw new Error('No hay ningún commit que enmendar')
    await git(dir, ['commit', '--amend', ...(text ? ['-m', text] : ['--no-edit'])])
    return { stagedOnly: true, amended: true }
  }
  if (!text) throw new Error('Escribe un mensaje de commit')
  const staged = await hasStaged(dir)
  if (!staged) await git(dir, ['add', '-A'])
  if (!await hasStaged(dir)) throw new Error('No hay cambios que confirmar')
  await git(dir, ['commit', '-m', text])
  return { stagedOnly: staged }
}

async function assertBranchName(dir, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.trim() !== name) throw new Error('Introduce un nombre de rama válido')
  await git(dir, ['check-ref-format', '--branch', name]).catch(() => { throw new Error('Nombre de rama no válido') })
}
async function assertLocalBranch(dir, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || !await exists(dir, `refs/heads/${name}`)) throw new Error('Rama no válida')
}

async function renameBranch(dir, name, newName) {
  assertDir(dir)
  await assertLocalBranch(dir, name); await assertBranchName(dir, newName)
  if (name === newName) return
  if (await exists(dir, `refs/heads/${newName}`)) throw new Error(`La rama «${newName}» ya existe`)
  await git(dir, ['branch', '-m', name, newName])
}

// Deleting is non-forced by default so git refuses unmerged branches; the UI offers `force` after that error.
async function deleteBranch(dir, name, { force = false } = {}) {
  assertDir(dir)
  await assertLocalBranch(dir, name)
  if ((await git(dir, ['branch', '--show-current'])).trim() === name) throw new Error('No se puede borrar la rama actual. Cambia a otra rama primero.')
  await git(dir, ['branch', force ? '-D' : '-d', '--', name])
}

// Splits `refs/remotes/<remote>/<branch>`; remote names may themselves contain slashes, so match against `git remote`.
async function splitRemoteRef(dir, ref) {
  const match = typeof ref === 'string' && /^refs\/remotes\/(.+)$/.exec(ref)
  if (!match || match[1].startsWith('-') || !await exists(dir, ref)) throw new Error('Rama remota no válida')
  const remotes = (await git(dir, ['remote'])).split(/\r?\n/).filter(Boolean).sort((a, b) => b.length - a.length)
  const remote = remotes.find(item => match[1].startsWith(item + '/'))
  if (!remote) throw new Error('Rama remota no válida')
  const branch = match[1].slice(remote.length + 1)
  if (!branch || branch === 'HEAD') throw new Error('Rama remota no válida')
  return { remote, branch }
}

async function deleteRemoteBranch(dir, ref) {
  assertDir(dir)
  const { remote, branch } = await splitRemoteRef(dir, ref)
  await git(dir, ['push', remote, '--delete', '--', branch])
}

// upstreamRef = `refs/remotes/...` to track, or null/'' to stop tracking.
async function setUpstream(dir, name, upstreamRef: string | null) {
  assertDir(dir)
  await assertLocalBranch(dir, name)
  if (!upstreamRef) { await git(dir, ['branch', '--unset-upstream', name]); return }
  const { remote, branch } = await splitRemoteRef(dir, upstreamRef)
  await git(dir, ['branch', `--set-upstream-to=${remote}/${branch}`, name])
}

// Creates a local branch from a remote one (optionally with another name) and switches to it.
async function checkoutRemote(dir, ref, localName?: string) {
  assertDir(dir)
  const { remote, branch } = await splitRemoteRef(dir, ref)
  const name = localName || branch
  await assertBranchName(dir, name)
  if (await exists(dir, `refs/heads/${name}`)) throw new Error(`La rama «${name}» ya existe`)
  await git(dir, ['switch', '-c', name, '--track', `${remote}/${branch}`])
}

// Operations from the graph's branch badge menu. `ref` is a full `refs/heads/…` or `refs/remotes/…` ref.
async function branchOperation(dir, type, ref, options: { file?: string } = {}) {
  assertDir(dir)
  if (typeof ref !== 'string' || !/^refs\/(heads|remotes)\//.test(ref) || !await exists(dir, ref)) throw new Error('Rama no válida')
  const short = ref.replace(/^refs\/(heads|remotes)\//, '')
  if (type === 'merge') { await git(dir, ['merge', '--no-edit', ref]); return }
  if (type === 'pull') {
    if (ref.startsWith('refs/remotes/')) { const { remote, branch } = await splitRemoteRef(dir, ref); await git(dir, ['pull', '--no-edit', remote, '--', branch]); return }
    const remote = (await git(dir, ['config', `branch.${short}.remote`])).trim(), merge = (await git(dir, ['config', `branch.${short}.merge`])).trim().replace(/^refs\/heads\//, '')
    if (!remote || !merge) throw new Error(`«${short}» no tiene upstream`)
    await git(dir, ['pull', '--no-edit', remote, '--', merge]); return
  }
  if (type === 'fetch') {
    const { remote, branch } = await splitRemoteRef(dir, ref)
    await assertBranchName(dir, branch)
    await git(dir, ['fetch', remote, '--', `${branch}:${branch}`]); return
  }
  if (type === 'archive') {
    if (typeof options.file !== 'string' || !options.file) throw new Error('Archivo no válido')
    await git(dir, ['archive', '--format=zip', '-o', options.file, ref]); return
  }
  throw new Error('Acción no válida')
}

// Commits and then pushes; a push failure is reported without hiding that the commit itself succeeded.
async function commitAndPush(dir, message, options: { amend?: boolean } = {}) {
  const result = await commitChanges(dir, message, options)
  try { await pushRepo(dir) } catch (error) { throw new Error('El commit se creó, pero el push falló: ' + error.message) }
  return result
}

async function changesForMessage(dir) {
  const staged = await hasStaged(dir)
  const diff = await git(dir, ['-c', 'core.quotepath=false', 'diff', ...(staged ? ['--cached'] : ['HEAD']), '--no-ext-diff', '--no-textconv', '--stat', '--patch']).catch(() => '')
  const untracked = staged ? '' : (await git(dir, ['ls-files', '--others', '--exclude-standard'])).split(/\r?\n/).filter(Boolean).map(file => `Nuevo archivo: ${file}`).join('\n')
  const text = [diff, untracked].filter(Boolean).join('\n\n')
  return text.length > MAX_DIFF ? text.slice(0, MAX_DIFF) + '\n[…recortado]' : text
}

const SYSTEM = 'Eres un generador de mensajes de commit. Recibes un diff de git por la entrada estándar. Responde SOLO con el mensaje de commit en formato Conventional Commits (tipo(ámbito opcional): resumen en imperativo, máximo 72 caracteres), opcionalmente seguido de una línea en blanco y un cuerpo breve. Sin comillas, sin bloques de código, sin explicaciones. Escribe el mensaje en inglés.'

function runClaude(input: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--system-prompt', SYSTEM], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('La generación ha tardado demasiado')) }, 60000)
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', (error: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' ? 'No se encontró la CLI «claude». Instálala e inicia sesión para generar mensajes.' : error.message)) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim() || `claude terminó con código ${code}`)) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

async function generateCommitMessage(dir, runner: (input: string) => Promise<string> = runClaude) {
  assertDir(dir)
  const changes = await changesForMessage(dir)
  if (!changes.trim()) throw new Error('No hay cambios para describir')
  const message = (await runner(changes)).trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
  if (!message) throw new Error('La IA no devolvió ningún mensaje')
  return message
}

export { listBranches, switchBranch, createBranch, renameBranch, deleteBranch, deleteRemoteBranch, setUpstream, checkoutRemote, branchOperation, commitChanges, commitAndPush, generateCommitMessage }
