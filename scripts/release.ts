// Usage: pnpm release <version> [--notes "texto"] [--publish]
// Bumps the version, builds the signed NSIS installer and writes latest.json.
// Release notes are generated from commits since the last version tag unless --notes is supplied.
// With --publish it also creates the GitHub release (requires `gh` logged in).
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repo = 'rubenglam/project-git-branch'
const args = process.argv.slice(2)
const version = args.find(a => /^\d+\.\d+\.\d+$/.test(a))
const flag = (name: string) => args.indexOf(name)
const notesIndex = flag('--notes')
const explicitNotes = notesIndex >= 0 ? args[notesIndex + 1] : undefined
const publish = args.includes('--publish')
if (!version || (notesIndex >= 0 && explicitNotes === undefined)) { console.error('Uso: pnpm release <x.y.z> [--notes "texto"] [--publish]'); process.exit(1) }

const run = (cmd: string, env: NodeJS.ProcessEnv = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
const git = (...gitArgs: string[]) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim()
const generateNotes = () => {
  const tag = git('tag', '--sort=-version:refname').split(/\r?\n/).find(Boolean)
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  const entries = git('log', range, '--no-merges', '--format=%s').split(/\r?\n/).filter(Boolean)
  const groups = new Map<string, string[]>([['Novedades', []], ['Correcciones', []], ['Otros cambios', []]])
  for (const subject of entries) {
    const conventional = subject.match(/^([a-z]+)(?:\([^)]*\))?(!)?:\s*(.+)$/i)
    const type = conventional?.[1].toLowerCase()
    if (type === 'feat' || subject.includes('!:')) groups.get('Novedades')!.push(conventional?.[3] ?? subject)
    else if (type === 'fix' || type === 'perf') groups.get('Correcciones')!.push(conventional?.[3] ?? subject)
    else if (type && ['chore', 'docs', 'style', 'ci', 'test', 'build'].includes(type)) continue
    else groups.get('Otros cambios')!.push(conventional?.[3] ?? subject)
  }
  const sections = [...groups].filter(([, items]) => items.length).map(([title, items]) => `### ${title}\n${items.map(item => `- ${item}`).join('\n')}`)
  return sections.join('\n\n') || 'Sin cambios descritos en los commits.'
}
const notes = explicitNotes ?? generateNotes()
const edit = (file: string, pattern: RegExp, replacement: string) => {
  const path = join(root, file), text = readFileSync(path, 'utf8')
  if (!pattern.test(text)) throw new Error(`No se encontró la versión en ${file}`)
  writeFileSync(path, text.replace(pattern, replacement))
}

edit('package.json', /("version":\s*")[^"]+(")/, `$1${version}$2`)
edit('src-tauri/tauri.conf.json', /("version":\s*")[^"]+(")/, `$1${version}$2`)
edit('src-tauri/Cargo.toml', /^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)

// `tauri build` only reads TAURI_SIGNING_PRIVATE_KEY (the key content), not a path.
const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), '.tauri', 'git-glam.key')
run('pnpm package:win', {
  TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY ?? readFileSync(keyPath, 'utf8').trim(),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
})

const bundle = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const installer = readdirSync(bundle).find(f => f.includes(`_${version}_`) && f.endsWith('-setup.exe'))
if (!installer) throw new Error(`No hay instalador ${version} en ${bundle}`)
const signature = readFileSync(join(bundle, installer + '.sig'), 'utf8').trim()

const out = join(root, 'release-updates', version)
mkdirSync(out, { recursive: true })
const assetName = installer.replaceAll(' ', '-')
copyFileSync(join(bundle, installer), join(out, assetName))
copyFileSync(join(bundle, installer + '.sig'), join(out, assetName + '.sig'))
const latest = {
  version, notes, pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature, url: `https://github.com/${repo}/releases/download/v${version}/${assetName}` } },
}
writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2))
console.log(`\nListo: ${out}`)

if (publish) {
  const notesPath = join(out, 'release-notes.md')
  writeFileSync(notesPath, notes || `Git Glam ${version}`)
  try {
    execFileSync('gh', ['release', 'create', `v${version}`, assetName, `${assetName}.sig`, 'latest.json', '--repo', repo, '--title', `v${version}`, '--notes-file', notesPath], { cwd: out, stdio: 'inherit' })
  } finally {
    rmSync(notesPath, { force: true })
  }
} else console.log('Para publicar: añade --publish o sube esos 3 archivos a una release v' + version)
