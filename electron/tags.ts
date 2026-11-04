import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const HASH = /^[a-f0-9]{40,64}$/i

async function git(cwd, args) {
  try {
    return (await run('git', args, { cwd, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout
  } catch (error) {
    throw new Error([error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message)
  }
}
const assertDir = dir => { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }
const exists = (cwd, ref) => git(cwd, ['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false)

async function assertTagName(dir, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.trim() !== name) throw new Error('Introduce un nombre de etiqueta válido')
  await git(dir, ['check-ref-format', `refs/tags/${name}`]).catch(() => { throw new Error('Nombre de etiqueta no válido') })
}
async function assertExisting(dir, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || !await exists(dir, `refs/tags/${name}`)) throw new Error('Etiqueta no válida')
}

async function remoteFor(dir, remote) {
  const remotes = (await git(dir, ['remote'])).split(/\r?\n/).filter(Boolean)
  if (!remotes.length) throw new Error('El repositorio no tiene remotos configurados')
  if (remote === undefined || remote === null || remote === '') return remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remotes.includes(remote)) throw new Error('Remoto no válido')
  return remote
}

// Lists tags newest first. `annotated` tags are tag objects (they carry a message); lightweight ones point straight at a commit.
async function listTags(dir) {
  assertDir(dir)
  const text = await git(dir, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%1f%(objecttype)%1f%(*objectname)%1f%(objectname)%1f%(creatordate:short)%1f%(contents:subject)', 'refs/tags'])
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [name, type, target, object, date, subject] = line.split('\x1f')
    const annotated = type === 'tag'
    return { name, annotated, commit: annotated ? target : object, date, message: annotated ? subject : '' }
  })
}

// With a message the tag is annotated (needs a committer identity); without one it is lightweight.
async function createTag(dir, { name, hash = 'HEAD', message = '' }: { name?: string; hash?: string; message?: string } = {}) {
  assertDir(dir)
  await assertTagName(dir, name)
  if (hash !== 'HEAD' && !(typeof hash === 'string' && HASH.test(hash))) throw new Error('Commit no válido')
  if (await exists(dir, `refs/tags/${name}`)) throw new Error(`La etiqueta «${name}» ya existe`)
  const text = typeof message === 'string' ? message.trim() : ''
  await git(dir, text ? ['tag', '-a', '-m', text, '--', name, hash] : ['tag', '--', name, hash])
}

async function deleteTag(dir, name, { remote = false, remoteName }: { remote?: boolean; remoteName?: string } = {}) {
  assertDir(dir)
  if (remote) {
    const target = await remoteFor(dir, remoteName)
    if (typeof name !== 'string' || !name || name.startsWith('-')) throw new Error('Etiqueta no válida')
    await git(dir, ['push', target, '--delete', `refs/tags/${name}`])
    return
  }
  await assertExisting(dir, name)
  await git(dir, ['tag', '-d', '--', name])
}

async function pushTag(dir, name, remoteName?: string) {
  assertDir(dir)
  await assertExisting(dir, name)
  const target = await remoteFor(dir, remoteName)
  await git(dir, ['push', target, `refs/tags/${name}:refs/tags/${name}`])
}

export { listTags, createTag, deleteTag, pushTag }
