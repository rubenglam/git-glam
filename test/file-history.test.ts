import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseFileLog, parseBlame, fileHistory, fileBlame } from '../electron/file-history.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('parseFileLog tracks the path across renames and merges', () => {
  const out = '\x1ea1\x1fAna\x1f2024-01-02\x1fnew\x1f\n\nnew.txt\n\x1eb2\x1fAna\x1f2024-01-01\x1fmerge\x1f\n\x1ec3\x1fAna\x1f2023-01-01\x1fold\x1f\n\nold.txt\n'
  assert.deepEqual(parseFileLog(out, 'new.txt').map(entry => entry.path), ['new.txt', 'new.txt', 'old.txt'])
})

test('parseBlame reads metadata once per commit', () => {
  const h = 'a'.repeat(40)
  const out = `${h} 1 1 2\nauthor Ana\nauthor-time 1700000000\nsummary first\nfilename f\n\tone\n${h} 2 2\n\ttwo\n`
  const lines = parseBlame(out)
  assert.equal(lines.length, 2)
  assert.deepEqual([lines[1].author, lines[1].summary, lines[1].text, lines[1].time], ['Ana', 'first', 'two', 1700000000000])
})

test('fileHistory follows renames and fileBlame blames at a revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-fh-'))
  git(dir, 'init', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't')
  await writeFile(join(dir, 'old.txt'), 'one\ntwo\nthree\nfour\nfive\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'add')
  git(dir, 'mv', 'old.txt', 'new.txt'); git(dir, 'commit', '-m', 'rename')
  await writeFile(join(dir, 'new.txt'), 'one\nTWO\nthree\nfour\nfive\n'); git(dir, 'commit', '-am', 'edit')
  const history = await fileHistory(dir, 'new.txt')
  assert.deepEqual(history.map(entry => entry.subject), ['edit', 'rename', 'add'])
  assert.equal(history[2].path, 'old.txt')
  const blame = await fileBlame(dir, history[0].path, history[0].hash)
  assert.deepEqual(blame.map(line => line.summary), ['add', 'edit', 'add', 'add', 'add'])
  await assert.rejects(fileHistory(dir, '-x'), /Archivo no válido/)
  await assert.rejects(fileBlame(dir, 'new.txt', 'HEAD'), /Commit no válido/)
})
