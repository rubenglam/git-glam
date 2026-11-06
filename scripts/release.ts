// Usage: pnpm release <version> [--notes "texto"] [--publish]
// Bumps the version, builds the signed NSIS installer and writes latest.json.
// With --publish it also creates the GitHub release (requires `gh` logged in).
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repo = 'rubenglam/project-git-branch'
const args = process.argv.slice(2)
const version = args.find(a => /^\d+\.\d+\.\d+$/.test(a))
const flag = (name: string) => args.indexOf(name)
const notes = flag('--notes') >= 0 ? args[flag('--notes') + 1] ?? '' : ''
const publish = args.includes('--publish')
if (!version) { console.error('Uso: pnpm release <x.y.z> [--notes "texto"] [--publish]'); process.exit(1) }

const run = (cmd: string, env: NodeJS.ProcessEnv = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
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
  const files = [assetName, assetName + '.sig', 'latest.json'].map(f => `"${join(out, f)}"`).join(' ')
  run(`gh release create v${version} ${files} --repo ${repo} --title "v${version}" --notes "${notes.replaceAll('"', '\\"') || `Git Glam ${version}`}"`)
} else console.log('Para publicar: añade --publish o sube esos 3 archivos a una release v' + version)
