import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const BASE = ['--literal-pathspecs', '-c', 'core.quotepath=false']
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

async function git(cwd, args, encoding: 'utf8' = 'utf8') {
  try {
    return (await run('git', [...BASE, ...args], { cwd, encoding, timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: ENV })).stdout
  } catch (error) {
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}

function assertDir(dir) { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }
function assertPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.some(item => typeof item !== 'string' || !item || item.includes('\0') || item.startsWith('-'))) throw new Error('Archivos no válidos')
}

async function stagePaths(dir, paths) {
  assertDir(dir); assertPaths(paths)
  await git(dir, ['add', '-A', '--', ...paths])
}

// `git reset` (unlike `restore --staged`) also works before the first commit exists.
async function unstagePaths(dir, paths) {
  assertDir(dir); assertPaths(paths)
  await git(dir, ['reset', '-q', '--', ...paths])
}

async function isTracked(dir, file) {
  return (await git(dir, ['ls-files', '--', file])).trim().length > 0
}

// Diff of one file as the working tree sees it: staged=true compares index with HEAD, staged=false the work tree with the index.
// Untracked files have no index entry, so they are shown as an all-added diff against /dev/null.
async function rawDiff(dir, file, staged, encoding) {
  const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv']
  if (staged) return git(dir, [...common, '--cached', '--', file], encoding)
  if (await isTracked(dir, file)) return git(dir, [...common, '--', file], encoding)
  try {
    return (await run('git', [...BASE, ...common, '--no-index', '--', '/dev/null', file], { cwd: dir, encoding, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: ENV })).stdout
  } catch (error) {
    if (error.code === 1 && typeof error.stdout !== 'undefined') return error.stdout // --no-index exits 1 when the files differ
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}

async function workingDiff(dir, request) {
  assertDir(dir)
  if (!request || typeof request.path !== 'string' || !request.path || request.path.startsWith('-')) throw new Error('Archivo no válido')
  return rawDiff(dir, request.path, Boolean(request.staged), 'utf8')
}

function splitPatch(patch) {
  const first = patch.search(/^@@ /m)
  if (first < 0) return { header: patch, hunks: [] }
  return { header: patch.slice(0, first), hunks: patch.slice(first).split(/^(?=@@ )/m) }
}
const rangeOf = hunk => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(hunk)?.[0]

function checkHunkRequest(request) {
  if (!request || typeof request.path !== 'string' || !request.path || request.path.startsWith('-') || !Number.isInteger(request.index) || request.index < 0 || typeof request.header !== 'string') throw new Error('Bloque no válido')
}

// Rebuilds the patch for one hunk from a fresh diff rather than taking it from the renderer, and the hunk header must
// still match so a file that changed meanwhile is never half-applied. latin1 round-trips arbitrary bytes.
async function applyHunkPatch(dir, request, staged, args) {
  const { header, hunks } = splitPatch(await rawDiff(dir, request.path, staged, 'latin1'))
  const hunk = hunks[request.index]
  if (!hunk || rangeOf(hunk) !== rangeOf(request.header)) throw new Error('El archivo ha cambiado. Actualiza los cambios e inténtalo de nuevo.')
  const patch = Buffer.from(header + (hunk.endsWith('\n') ? hunk : hunk + '\n'), 'latin1')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', [...BASE, 'apply', ...args, '--recount', '--whitespace=nowarn', '-'], { cwd: dir, windowsHide: true, env: ENV, stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `git apply terminó con código ${code}`)))
    child.stdin.on('error', () => {})
    child.stdin.end(patch)
  })
}

// Stages (or, with staged=true, unstages) a single hunk.
async function applyHunk(dir, request) {
  assertDir(dir); checkHunkRequest(request)
  const staged = Boolean(request.staged)
  if (!staged && !await isTracked(dir, request.path)) throw new Error('Los archivos nuevos solo se pueden preparar enteros')
  await applyHunkPatch(dir, request, staged, ['--cached', ...(staged ? ['--reverse'] : [])])
}

// Throws away one unstaged hunk by reverse-applying it to the working tree only.
async function discardHunk(dir, request) {
  assertDir(dir); checkHunkRequest(request)
  if (!await isTracked(dir, request.path)) throw new Error('Los archivos nuevos solo se pueden descartar enteros')
  await applyHunkPatch(dir, request, false, ['--reverse'])
}

// Discards unstaged changes: tracked files go back to their index version, untracked files are deleted.
// Staged changes are left alone (the index version is what the work tree is restored to).
async function discardPaths(dir, paths) {
  assertDir(dir); assertPaths(paths)
  const tracked = new Set((await git(dir, ['ls-files', '-z', '--', ...paths])).split('\0').filter(Boolean))
  const restore = paths.filter(item => tracked.has(item)), clean = paths.filter(item => !tracked.has(item))
  if (restore.length) await git(dir, ['restore', '--worktree', '--', ...restore])
  if (clean.length) await git(dir, ['clean', '-f', '-q', '--', ...clean])
}

async function lastCommitMessage(dir) {
  assertDir(dir)
  try { return (await git(dir, ['log', '-1', '--format=%B'])).trimEnd() } catch { return '' }
}

export { stagePaths, unstagePaths, workingDiff, applyHunk, discardHunk, discardPaths, lastCommitMessage }
