import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseTracking, fetchRepo, pullRepo, pushRepo } from '../electron/sync.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('parseTracking reads ahead/behind and ignores branches without upstream', () => {
  const text = ['main\x1forigin/main\x1fahead 2, behind 3', 'dev\x1forigin/dev\x1f', 'old\x1forigin/old\x1fgone', 'local\x1f\x1f', ''].join('\n')
  const { names, sync } = parseTracking(text)
  assert.deepEqual(names, ['main', 'dev', 'old', 'local'])
  assert.deepEqual(sync, {
    main: { upstream: 'origin/main', ahead: 2, behind: 3, gone: false },
    dev: { upstream: 'origin/dev', ahead: 0, behind: 0, gone: false },
    old: { upstream: 'origin/old', ahead: 0, behind: 0, gone: true },
  })
})

test('fetch, pull and push work against a remote', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-graph-sync-'))
  const remote = join(base, 'remote.git'), a = join(base, 'a'), b = join(base, 'b')
  git(base, 'init', '--bare', '-b', 'main', remote)
  git(base, 'clone', remote, a)
  for (const dir of [a]) { git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't') }
  git(a, 'commit', '--allow-empty', '-m', 'one')
  await pushRepo(a) // no upstream yet: sets it
  assert.match(git(a, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), /origin\/main/)
  git(base, 'clone', remote, b)
  git(b, 'config', 'user.email', 't@t'); git(b, 'config', 'user.name', 't')
  git(b, 'commit', '--allow-empty', '-m', 'two')
  await pushRepo(b)
  await fetchRepo(a)
  assert.equal(git(a, 'rev-list', '--count', 'HEAD..@{upstream}').trim(), '1')
  await pullRepo(a)
  assert.equal(git(a, 'rev-list', '--count', 'HEAD..@{upstream}').trim(), '0')
  await assert.rejects(fetchRepo(''), /Ruta no válida/)
})
