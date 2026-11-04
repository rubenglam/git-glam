import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { runCommitAction } from '../electron/commit-actions.ts'
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-actions-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'base.txt'), 'base'); git('add', 'base.txt'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  async function commit(file, contents, message) { await writeFile(join(dir, file), contents); git('add', file); git('commit', '-m', message); return git('rev-parse', 'HEAD') }
  const act = (type, hash, extra = {}) => runCommitAction(dir, { type, hash, expectedHead: git('rev-parse', 'HEAD'), expectedBranch: git('branch', '--show-current') || 'HEAD separado', ...extra })
  return { dir, git, base, commit, act }
}

test('create tag and branch, reject stale HEAD and checkout a commit', async () => {
  const f = await fixture(), second = await f.commit('b.txt', 'b', 'second')
  await f.act('tag', f.base, { name: 'v1' }); await f.act('branch', f.base, { name: 'new-branch' })
  assert.equal(f.git('rev-parse', 'v1'), f.base); assert.equal(f.git('rev-parse', 'new-branch'), f.base)
  await f.act('tag', f.base, { name: 'v2', message: 'Release' })
  assert.equal(f.git('cat-file', '-t', 'v2'), 'tag'); assert.equal(f.git('cat-file', '-t', 'v1'), 'commit')
  await assert.rejects(f.act('branch', f.base, { name: '--bad' }), /válido/)
  await assert.rejects(runCommitAction(f.dir, { type: 'reset', hash: f.base, mode: 'hard', expectedHead: f.base, expectedBranch: 'main' }), /han cambiado/)
  assert.equal(f.git('rev-parse', 'HEAD'), second)
  await f.act('checkout', f.base); assert.equal(f.git('rev-parse', 'HEAD'), f.base); assert.equal(f.git('branch', '--show-current'), '')
})

test('cherry-pick and revert apply commits to the current branch', async () => {
  const f = await fixture(); f.git('checkout', '-b', 'feature')
  const feature = await f.commit('feature.txt', 'feature', 'feature')
  f.git('checkout', 'main'); await f.act('cherry-pick', feature)
  assert.equal(await readFile(join(f.dir, 'feature.txt'), 'utf8'), 'feature')
  const picked = f.git('rev-parse', 'HEAD'); await f.act('revert', picked)
  assert.equal(f.git('status', '--porcelain'), ''); assert.equal(f.git('ls-files', 'feature.txt'), '')
})

test('merge and rebase target the selected commit', async () => {
  const f = await fixture(); f.git('checkout', '-b', 'feature')
  const feature = await f.commit('feature.txt', 'feature', 'feature')
  f.git('checkout', 'main'); await f.act('merge', feature)
  assert.equal(f.git('rev-parse', 'HEAD'), feature)
  f.git('checkout', '-b', 'topic', f.base); await f.commit('topic.txt', 'topic', 'topic')
  await f.act('rebase', feature)
  assert.equal(f.git('rev-parse', 'HEAD^'), feature)
})

test('reset modes are validated and hard reset updates tracked files', async () => {
  const f = await fixture(); await f.commit('base.txt', 'changed', 'change')
  await assert.rejects(f.act('reset', f.base, { mode: 'invalid' }), /Modo/)
  await f.act('reset', f.base, { mode: 'hard' })
  assert.equal(f.git('rev-parse', 'HEAD'), f.base); assert.equal(await readFile(join(f.dir, 'base.txt'), 'utf8'), 'base')
})

test('merge commits require an explicit valid mainline for cherry-pick', async () => {
  const f = await fixture(); f.git('checkout', '-b', 'feature'); await f.commit('feature.txt', 'feature', 'feature')
  f.git('checkout', 'main'); await f.commit('main.txt', 'main', 'main'); f.git('merge', '--no-ff', '--no-edit', 'feature')
  const merge = f.git('rev-parse', 'HEAD'); f.git('checkout', '-b', 'target', f.base)
  await assert.rejects(f.act('cherry-pick', merge), /padre principal/)
  await f.act('cherry-pick', merge, { mainline: 1 })
  assert.equal(await readFile(join(f.dir, 'feature.txt'), 'utf8'), 'feature')
})
