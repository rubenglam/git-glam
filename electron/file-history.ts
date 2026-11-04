import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const BASE = ['--literal-pathspecs', '-c', 'core.quotepath=false']
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
const HASH = /^[a-f0-9]{40,64}$/i
const MAX_ENTRIES = 2000

async function git(cwd, args) {
  try {
    return (await run('git', [...BASE, ...args], { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: ENV })).stdout
  } catch (error) {
    throw new Error([error.stderr, error.stdout].filter(Boolean).join('\n').trim() || error.message)
  }
}

function assertRequest(dir, file, rev) {
  if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida')
  if (typeof file !== 'string' || !file || file.includes('\0') || file.startsWith('-')) throw new Error('Archivo no válido')
  if (rev !== undefined && rev !== null && !(typeof rev === 'string' && HASH.test(rev))) throw new Error('Commit no válido')
}

// Parses `git log --follow --name-only --format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f`. --name-only prints the path the file had at each
// commit, so renames show up as a changing path. Merges print no path (they have no diff), so they inherit the next newer one.
function parseFileLog(output, file) {
  let current = file
  return output.split('\x1e').filter(record => record.trim()).map(record => {
    const [hash, author, date, subject, rest = ''] = record.split('\x1f')
    const path = rest.split('\n').map(line => line.replace(/\r$/, '')).find(Boolean)
    if (path) current = path
    return { hash: hash.trim(), author, date, subject, path: current }
  })
}

// Parses `git blame --porcelain`: a header "<hash> <orig> <final> [<group size>]" per line, with commit metadata only the first time
// a commit appears, followed by the source line prefixed by a tab.
function parseBlame(output) {
  const commits = new Map<string, { author?: string; time?: number; summary?: string }>(), lines: { line: number; hash: string; author: string; time: number; summary: string; text: string }[] = []
  let header: { hash: string; line: number } | null = null
  for (const raw of output.split('\n')) {
    if (raw.startsWith('\t')) {
      if (!header) continue
      const info = commits.get(header.hash) || {}
      lines.push({ line: header.line, hash: header.hash, author: info.author || '', time: info.time || 0, summary: info.summary || '', text: raw.slice(1).replace(/\r$/, '') })
      header = null
      continue
    }
    const start = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(raw)
    if (start) { header = { hash: start[1], line: Number(start[2]) }; if (!commits.has(header.hash)) commits.set(header.hash, {}); continue }
    if (!header) continue
    const info = commits.get(header.hash)!, space = raw.indexOf(' ')
    if (space < 0) continue
    const key = raw.slice(0, space), value = raw.slice(space + 1)
    if (key === 'author') info.author = value
    else if (key === 'author-time') info.time = Number(value) * 1000
    else if (key === 'summary') info.summary = value
  }
  return lines
}

// History of one file following renames, starting at `rev` (default HEAD) so the path only has to exist there.
async function fileHistory(dir, file, rev?: string) {
  assertRequest(dir, file, rev)
  const output = await git(dir, ['log', '--follow', '--no-color', '--no-ext-diff', '--name-only', '-n', String(MAX_ENTRIES), '--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f', rev || 'HEAD', '--', file])
  return parseFileLog(output, file)
}

// Blame of `file` as it was at commit `rev`. Lines of the commit being shown are authored by it or by older ones.
async function fileBlame(dir, file, rev?: string) {
  assertRequest(dir, file, rev)
  if (!rev) throw new Error('Commit no válido')
  return parseBlame(await git(dir, ['blame', '--porcelain', '-M', rev, '--', file]))
}

export { parseFileLog, parseBlame, fileHistory, fileBlame }
