import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createTokenStore, repoKey } from '../electron/tokens.ts'
const crypt = { encrypt: text => Buffer.from([...text].reverse().join('')), decrypt: buffer => [...buffer.toString()].reverse().join('') }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('tokens are stored encrypted per repository and removable', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'git-graph-tokens-')), 'tokens.json')
  const store = createTokenStore(file, crypt)
  assert.equal(await store.has('a'), false)
  await store.set('a', ' glpat-abc ')
  assert.equal(await store.get('a'), 'glpat-abc')
  assert.equal(await store.get('b'), '')
  assert.equal((await readFile(file, 'utf8')).includes('glpat-abc'), false)
  assert.equal(await createTokenStore(file, crypt).has('a'), true)
  await store.set('a', '')
  assert.equal(await store.has('a'), false)
})

test('tokens fall back to plain text without encryption and reject bad input', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'git-graph-tokens-')), 'tokens.json')
  const store = createTokenStore(file)
  await store.set('r', 'ghp_x')
  assert.equal(await createTokenStore(file).get('r'), 'ghp_x')
  await assert.rejects(store.set('', 'x'), /Repositorio/)
  await assert.rejects(store.set('r', 'a b'), /Token/)
  await assert.rejects(store.set('r', 5), /Token/)
})

test('repoKey is shared by the worktrees of one repository', async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-graph-repokey-'))
  const main = join(base, 'main'), other = join(base, 'other')
  git(base, 'init', '-b', 'main', main)
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'one')
  git(main, 'worktree', 'add', '-b', 'feature', other)
  assert.equal(await repoKey(other), await repoKey(main))
  await assert.rejects(repoKey(base), /repositorio/)
})
