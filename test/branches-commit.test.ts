import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { listBranches, switchBranch, createBranch, commitChanges, generateCommitMessage } from '../electron/branches-commit.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-branches-'))
  git(dir, 'init', '-b', 'main'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 'T')
  await writeFile(join(dir, 'a.txt'), 'a'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'init')
  return dir
}

test('branches can be listed, created and switched', async () => {
  const dir = await repo()
  await createBranch(dir, 'feat/x')
  assert.equal((await listBranches(dir)).current, 'feat/x')
  await assert.rejects(createBranch(dir, 'feat/x'), /ya existe/)
  await assert.rejects(createBranch(dir, '-bad'), /válido/)
  await switchBranch(dir, 'refs/heads/main')
  const { current, branches } = await listBranches(dir)
  assert.equal(current, 'main')
  assert.deepEqual(branches.map(b => b.name).sort(), ['feat/x', 'main'])
  await assert.rejects(switchBranch(dir, 'refs/heads/nope'), /no válida/)
})

test('commit uses staged changes only, otherwise everything', async () => {
  const dir = await repo()
  await assert.rejects(commitChanges(dir, '  '), /mensaje/)
  await assert.rejects(commitChanges(dir, 'x'), /No hay cambios/)
  await writeFile(join(dir, 'b.txt'), 'b'); await writeFile(join(dir, 'c.txt'), 'c')
  git(dir, 'add', 'b.txt')
  assert.deepEqual(await commitChanges(dir, 'feat: b'), { stagedOnly: true })
  assert.match(git(dir, 'status', '--porcelain'), /\?\? c\.txt/)
  assert.deepEqual(await commitChanges(dir, 'feat: c'), { stagedOnly: false })
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('generated message receives the changes and is cleaned up', async () => {
  const dir = await repo()
  await assert.rejects(generateCommitMessage(dir, async () => 'x'), /No hay cambios/)
  await writeFile(join(dir, 'a.txt'), 'changed'); await writeFile(join(dir, 'new.txt'), 'n')
  let seen
  const message = await generateCommitMessage(dir, async input => { seen = input; return '```\nfeat: cambia a\n```\n' })
  assert.equal(message, 'feat: cambia a')
  assert.match(seen, /a\.txt/); assert.match(seen, /Nuevo archivo: new\.txt/)
})
