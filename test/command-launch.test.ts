import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { launchProjectCommand } from '../electron/command-launch.ts'

test('launcher passes the command and both paths separately to PowerShell', { skip: process.platform !== 'win32' }, async () => {
  const project = "C:\\repos\\project ' $(write-host bad)", worktree = project + '\\work tree'
  let received: any
  const fakeSpawn = (executable, args, options) => {
    received = { executable, args, options }
    const child = Object.assign(new EventEmitter(), { unref() {} }); process.nextTick(() => child.emit('spawn')); return child
  }
  await launchProjectCommand({ command: 'code .', project, worktree }, fakeSpawn)
  assert.equal(Buffer.from(received.args.at(-1), 'base64').toString('utf16le'), 'code .')
  assert.equal(received.options.cwd, worktree)
  assert.equal(received.options.env.GITGRAPH_PROJECT, project)
  assert.equal(received.options.env.GITGRAPH_WORKTREE, worktree)
  assert.equal(received.options.windowsHide, false)
  await assert.rejects(launchProjectCommand({ command: ' ', project, worktree }, fakeSpawn), /Configura/)
})

test('PowerShell receives the actual worktree and project paths', { skip: process.platform !== 'win32' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'git-graph-command-'))
  const project = join(base, "project $() ' space"), worktree = join(project, 'work tree')
  await mkdir(worktree, { recursive: true })
  const command = '[IO.File]::WriteAllLines((Join-Path $env:GITGRAPH_WORKTREE "result.txt"), @($env:GITGRAPH_PROJECT, $env:GITGRAPH_WORKTREE, (Get-Location).Path))'
  const hiddenSpawn = (file, args, options) => spawn(file, args.filter(arg => arg !== '-NoExit'), { ...options, detached: false, windowsHide: true })
  await launchProjectCommand({ command, project, worktree }, hiddenSpawn)
  let result: string | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    try { result = await readFile(join(worktree, 'result.txt'), 'utf8'); break } catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  assert.ok(result, 'PowerShell did not write its result')
  const [reportedProject, reportedWorktree, reportedCwd] = result.trim().split(/\r?\n/)
  assert.equal(reportedProject, project)
  assert.equal(reportedWorktree, worktree)
  assert.equal((await realpath(reportedCwd)).toLowerCase(), (await realpath(worktree)).toLowerCase())
})
