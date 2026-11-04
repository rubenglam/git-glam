import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { discardPaths, discardHunk, workingDiff } from '../electron/staging.ts'
import { renameBranch, deleteBranch, deleteRemoteBranch, setUpstream, checkoutRemote, commitAndPush } from '../electron/branches-commit.ts'
import { stashPush, stashApply, stashPop, stashDrop, stashExtras } from '../electron/stash.ts'
import { listTags, createTag, deleteTag, pushTag } from '../electron/tags.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const lines = (n, mark = {}) => Array.from({ length: n }, (_, i) => mark[i + 1] ?? `line ${i + 1}`).join('\n') + '\n'

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-ops-'))
  git(dir, 'init', '-b', 'main'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'core.autocrlf', 'false')
  await writeFile(join(dir, 'a.txt'), lines(40)); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'init')
  return dir
}
// A clone with a bare origin, so pushes and remote branches can be exercised.
async function withRemote() {
  const dir = await repo()
  const bare = await mkdtemp(join(tmpdir(), 'git-graph-origin-'))
  git(bare, 'init', '--bare', '-b', 'main')
  git(dir, 'remote', 'add', 'origin', bare)
  git(dir, 'push', '-u', 'origin', 'main')
  return { dir, bare }
}

test('discards unstaged changes and untracked files but keeps staged ones', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'changed' })); await writeFile(join(dir, 'new.txt'), 'n\n')
  await discardPaths(dir, ['a.txt', 'new.txt'])
  assert.equal(git(dir, 'status', '--porcelain'), '')
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), lines(40))
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'staged' })); git(dir, 'add', 'a.txt')
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'staged', 40: 'extra' }))
  await discardPaths(dir, ['a.txt'])
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), lines(40, { 1: 'staged' }))
  assert.equal(git(dir, 'status', '--porcelain'), 'M  a.txt')
  await assert.rejects(discardPaths(dir, ['--force']), /no válidos/)
})

test('discards a single hunk and refuses a stale one', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'first', 40: 'last' }))
  const diff = await workingDiff(dir, { path: 'a.txt', staged: false })
  const headers = diff.split('\n').filter(line => line.startsWith('@@'))
  assert.equal(headers.length, 2)
  await assert.rejects(discardHunk(dir, { path: 'a.txt', index: 0, header: '@@ -9,9 +9,9 @@' }), /ha cambiado/)
  await discardHunk(dir, { path: 'a.txt', index: 0, header: headers[0] })
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), lines(40, { 40: 'last' }))
  await writeFile(join(dir, 'u.txt'), 'u\n')
  await assert.rejects(discardHunk(dir, { path: 'u.txt', index: 0, header: '@@ -0,0 +1 @@' }), /enteros/)
})

test('renames, deletes and re-tracks branches', async () => {
  const { dir } = await withRemote()
  git(dir, 'branch', 'feature')
  await renameBranch(dir, 'feature', 'feat/one')
  assert.match(git(dir, 'branch', '--list'), /feat\/one/)
  await assert.rejects(renameBranch(dir, 'feat/one', 'main'), /ya existe/)
  await assert.rejects(renameBranch(dir, 'feat/one', '-x'), /válido/)
  await assert.rejects(deleteBranch(dir, 'main'), /actual/)
  git(dir, 'switch', '-c', 'work'); await writeFile(join(dir, 'w.txt'), 'w\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'w'); git(dir, 'switch', 'main')
  await assert.rejects(deleteBranch(dir, 'work'), /not fully merged/)
  await deleteBranch(dir, 'work', { force: true })
  await deleteBranch(dir, 'feat/one')
  assert.doesNotMatch(git(dir, 'branch', '--list'), /work|feat/)
  git(dir, 'push', 'origin', 'main:topic')
  git(dir, 'fetch', 'origin')
  await setUpstream(dir, 'main', 'refs/remotes/origin/topic')
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/topic')
  await setUpstream(dir, 'main', null)
  assert.throws(() => git(dir, 'rev-parse', '--abbrev-ref', 'main@{upstream}'))
  await assert.rejects(setUpstream(dir, 'main', 'refs/remotes/nope/x'), /no válida/)
})

test('checks out a remote branch as a new local one and deletes remote branches', async () => {
  const { dir, bare } = await withRemote()
  git(dir, 'push', 'origin', 'main:topic'); git(dir, 'fetch', 'origin')
  await checkoutRemote(dir, 'refs/remotes/origin/topic', 'mine')
  assert.equal(git(dir, 'branch', '--show-current'), 'mine')
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'mine@{upstream}'), 'origin/topic')
  await assert.rejects(checkoutRemote(dir, 'refs/remotes/origin/topic', 'mine'), /ya existe/)
  await assert.rejects(checkoutRemote(dir, 'refs/heads/main'), /remota no válida/)
  await deleteRemoteBranch(dir, 'refs/remotes/origin/topic')
  assert.doesNotMatch(git(bare, 'branch', '--list'), /topic/)
})

test('commit & push publishes the commit; a failing push is reported after committing', async () => {
  const { dir, bare } = await withRemote()
  await writeFile(join(dir, 'b.txt'), 'b\n')
  await commitAndPush(dir, 'add b')
  assert.equal(git(bare, 'log', '-1', '--format=%s', 'main'), 'add b')
  git(dir, 'remote', 'set-url', 'origin', join(bare, 'missing'))
  await writeFile(join(dir, 'c.txt'), 'c\n')
  await assert.rejects(commitAndPush(dir, 'add c'), /commit se creó, pero el push falló/)
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'add c')
})

test('stash: create (with untracked), apply, pop and drop by hash', async () => {
  const dir = await repo()
  await assert.rejects(stashPush(dir, {}), /No hay cambios/)
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'changed' })); await writeFile(join(dir, 'u.txt'), 'u\n')
  await stashPush(dir, { message: 'wip', includeUntracked: true })
  assert.equal(git(dir, 'status', '--porcelain'), '')
  const hash = git(dir, 'rev-parse', 'stash@{0}')
  assert.match(git(dir, 'stash', 'list'), /wip/)
  assert.match(await stashExtras(dir, hash, ['--patch']), /\+u/)
  assert.equal(await stashExtras(dir, git(dir, 'rev-parse', 'HEAD'), ['--patch']), '')
  await stashApply(dir, hash)
  assert.match(git(dir, 'status', '--porcelain'), /\?\? u\.txt/)
  assert.ok(git(dir, 'stash', 'list'))
  git(dir, 'stash', 'push', '-u', '-m', 'second')
  git(dir, 'checkout', '--', '.'); git(dir, 'clean', '-fdq')
  // the first stash is now stash@{1}: it must still be found by hash
  await stashPop(dir, hash)
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), lines(40, { 1: 'changed' }))
  assert.equal(git(dir, 'stash', 'list').split('\n').length, 1)
  await stashDrop(dir, git(dir, 'rev-parse', 'stash@{0}'))
  assert.equal(git(dir, 'stash', 'list'), '')
  await assert.rejects(stashDrop(dir, hash), /ya no existe/)
  await assert.rejects(stashDrop(dir, 'HEAD'), /no válido/)
})

test('stash keep-index leaves staged changes in place', async () => {
  const dir = await repo()
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'staged' })); git(dir, 'add', 'a.txt')
  await writeFile(join(dir, 'a.txt'), lines(40, { 1: 'staged', 40: 'later' }))
  await stashPush(dir, { keepIndex: true })
  assert.equal(git(dir, 'status', '--porcelain'), 'M  a.txt')
})

test('tags: lightweight, annotated, listing, delete and push', async () => {
  const { dir, bare } = await withRemote()
  await createTag(dir, { name: 'v1' })
  await createTag(dir, { name: 'v2', message: 'Release two' })
  await assert.rejects(createTag(dir, { name: 'v1' }), /ya existe/)
  await assert.rejects(createTag(dir, { name: '-bad' }), /válido/)
  await assert.rejects(createTag(dir, { name: 'x y' }), /no válido/)
  await assert.rejects(createTag(dir, { name: 'v3', hash: 'main' }), /Commit no válido/)
  const list = await listTags(dir)
  const byName = Object.fromEntries(list.map(tag => [tag.name, tag]))
  assert.equal(byName.v1.annotated, false)
  assert.equal(byName.v2.annotated, true)
  assert.equal(byName.v2.message, 'Release two')
  assert.equal(byName.v1.commit, git(dir, 'rev-parse', 'HEAD'))
  assert.equal(byName.v2.commit, git(dir, 'rev-parse', 'HEAD'))
  await pushTag(dir, 'v2')
  assert.match(git(bare, 'tag', '--list'), /v2/)
  await assert.rejects(pushTag(dir, 'nope'), /no válida/)
  await deleteTag(dir, 'v2', { remote: true })
  assert.doesNotMatch(git(bare, 'tag', '--list'), /v2/)
  await deleteTag(dir, 'v2')
  assert.doesNotMatch(git(dir, 'tag', '--list'), /v2/)
  await assert.rejects(deleteTag(dir, 'v2'), /no válida/)
  assert.ok(!existsSync(join(dir, 'v2')))
})
