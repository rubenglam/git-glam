import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { stagePaths, unstagePaths, workingDiff, applyHunk, lastCommitMessage } from '../electron/staging.ts'
import { commitChanges } from '../electron/branches-commit.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const lines = (n, mark = {}) => Array.from({ length: n }, (_, i) => mark[i + 1] ?? `line ${i + 1}`).join('\n') + '\n'

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-staging-'))
  git(dir, 'init', '-b', 'main'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 'T')
  await writeFile(join(dir, 'a.txt'), lines(40)); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'init')
  return dir
}

test('stages and unstages whole files, including new and deleted ones', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'new.txt'), 'n\n'); await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'changed' }))
  await stagePaths(dir, ['new.txt', 'a.txt'])
  assert.equal(git(dir, 'status', '--porcelain'), 'M  a.txt\nA  new.txt\n')
  await unstagePaths(dir, ['new.txt'])
  assert.match(git(dir, 'status', '--porcelain'), /\?\? new\.txt/)
  await assert.rejects(stagePaths(dir, []), /no válidos/)
  await assert.rejects(stagePaths(dir, ['--all']), /no válidos/)
})

test('unstaging works before the first commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-staging-'))
  git(dir, 'init', '-b', 'main')
  await writeFile(join(dir, 'x.txt'), 'x\n'); await stagePaths(dir, ['x.txt'])
  await unstagePaths(dir, ['x.txt'])
  assert.equal(git(dir, 'status', '--porcelain'), '?? x.txt\n')
})

test('shows working, staged and untracked diffs', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 2: 'two' })); await writeFile(join(dir, 'u.txt'), 'u\n')
  assert.match(await workingDiff(dir, { path: 'a.txt', staged: false }), /\+two/)
  assert.equal(await workingDiff(dir, { path: 'a.txt', staged: true }), '')
  assert.match(await workingDiff(dir, { path: 'u.txt', staged: false }), /new file mode[\s\S]*\+u/)
  await stagePaths(dir, ['a.txt'])
  assert.match(await workingDiff(dir, { path: 'a.txt', staged: true }), /\+two/)
})

test('stages and unstages a single hunk', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 2: 'first', 38: 'second' }))
  const hunks = (await workingDiff(dir, { path: 'a.txt', staged: false })).split('\n').filter(line => line.startsWith('@@'))
  assert.equal(hunks.length, 2)
  await applyHunk(dir, { path: 'a.txt', staged: false, index: 1, header: hunks[1] })
  assert.match(git(dir, 'diff', '--cached'), /\+second/)
  assert.doesNotMatch(git(dir, 'diff', '--cached'), /first/)
  assert.match(git(dir, 'diff'), /\+first/)
  assert.equal(git(dir, 'status', '--porcelain'), 'MM a.txt\n')
  await applyHunk(dir, { path: 'a.txt', staged: true, index: 0, header: (await workingDiff(dir, { path: 'a.txt', staged: true })).split('\n').find(line => line.startsWith('@@')) })
  assert.equal(git(dir, 'diff', '--cached'), '')
})

test('refuses stale hunks, bad indexes and untracked files', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 2: 'first' }))
  const header = (await workingDiff(dir, { path: 'a.txt', staged: false })).split('\n').find(line => line.startsWith('@@'))
  await assert.rejects(applyHunk(dir, { path: 'a.txt', staged: false, index: 3, header }), /ha cambiado/)
  await assert.rejects(applyHunk(dir, { path: 'a.txt', staged: false, index: 0, header: '@@ -9,1 +9,1 @@' }), /ha cambiado/)
  await writeFile(join(dir, 'u.txt'), 'u\n')
  await assert.rejects(applyHunk(dir, { path: 'u.txt', staged: false, index: 0, header }), /enteros/)
  assert.equal(git(dir, 'diff', '--cached'), '')
})

test('amend rewrites the message and can absorb staged changes', async () => {
  const dir = await repo()
  assert.equal(await lastCommitMessage(dir), 'init')
  await commitChanges(dir, 'better message', { amend: true })
  assert.equal(git(dir, 'log', '-1', '--format=%s').trim(), 'better message')
  await writeFile(join(dir, 'b.txt'), 'b\n'); await stagePaths(dir, ['b.txt'])
  assert.deepEqual(await commitChanges(dir, '', { amend: true }), { stagedOnly: true, amended: true })
  assert.equal(git(dir, 'log', '-1', '--format=%s').trim(), 'better message')
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '1')
  assert.equal(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort().join(), 'a.txt,b.txt')
  const empty = await mkdtemp(join(tmpdir(), 'git-graph-staging-')); git(empty, 'init', '-b', 'main')
  await assert.rejects(commitChanges(empty, 'x', { amend: true }), /ningún commit/)
  assert.equal(await lastCommitMessage(empty), '')
})
