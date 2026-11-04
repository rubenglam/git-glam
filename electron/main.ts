import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { createProjectStore } from './projects.ts'
import { runCommitAction } from './commit-actions.ts'
import { createSettingsStore } from './settings.ts'
import { launchProjectCommand } from './command-launch.ts'
import * as branchesCommit from './branches-commit.ts'
import * as staging from './staging.ts'
import * as stash from './stash.ts'
import * as tags from './tags.ts'
import * as issues from './issues.ts'
import * as agentChat from './agent-chat.ts'
import { createAgentStore } from './agent-store.ts'
import { createTokenStore, repoKey } from './tokens.ts'
import { parseNumstat } from './commit-files.ts'
import * as fileHistory from './file-history.ts'
import { parseTracking, fetchRepo, pullRepo, pushRepo } from './sync.ts'
const run = promisify(execFile)
const git = async (cwd, args) => (await run('git', args, { cwd, timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout

const PAGE_SIZE = 500
const MAX_COMMITS = 200000
const pageLimit = value => Number.isInteger(value) && value > 0 ? Math.min(value, MAX_COMMITS) : PAGE_SIZE
const gitLog = (cwd, args) => run('git', args, { cwd, timeout: 120000, maxBuffer: 512 * 1024 * 1024, windowsHide: true }).then(result => result.stdout)

async function loadHistory(root, showRemote, limit) {
  let head = ''
  try { head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim() } catch (error) {
    const symbolic = (await git(root, ['symbolic-ref', 'HEAD'])).trim()
    if (!symbolic.startsWith('refs/heads/')) throw error
    try { await git(root, ['show-ref', '--verify', '--quiet', symbolic]) } catch (refError) {
      if (refError.code === 1) return { head: '', commits: [], limit, hasMore: false }
      throw refError
    }
    throw error
  }
  // One extra commit tells us whether more history exists without a second git call.
  const log = await gitLog(root, ['log', '--branches', ...(showRemote ? ['--remotes'] : []), '--tags', 'HEAD', '--topo-order', '-n', String(limit + 1), '--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%aI%x1f%ae%x1f%B%x1e'])
  const all = log.split('\x1e').map(x => x.trimStart()).filter(Boolean).map(record => {
    const [hash, parents, refs, subject, author, date, email, message] = record.split('\x1f')
    return { hash, parents: parents ? parents.split(' ') : [], refs: refs ? refs.split(', ') : [], subject, author, date, email, message: (message || subject).trimEnd() }
  })
  return { head, commits: all.slice(0, limit), limit, hasMore: all.length > limit }
}

async function loadRepo(dir, showRemote = true, limit = PAGE_SIZE) {
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  const [branchText, status, remoteText, branchRefs, worktreeText, stashLog, { head, commits, hasMore }] = await Promise.all([
    git(root, ['branch', '--show-current']),
    git(root, ['status', '--porcelain=v1', '--no-renames', '--untracked-files=all', '-z']),
    git(root, ['remote']),
    git(root, ['for-each-ref', '--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)', 'refs/heads']),
    git(root, ['worktree', 'list', '--porcelain', '-z']),
    git(root, ['stash', 'list', '--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%an%x1f%aI%x1f%ae%x1f%B%x1e']),
    loadHistory(root, showRemote, pageLimit(limit)),
  ])
  const branch = branchText.trim() || 'HEAD separado'
  const changes = status.split('\0').filter(Boolean).map(entry => ({ status: entry.slice(0, 2), path: entry.slice(3) }))
  const remotes = remoteText.split(/\r?\n/).filter(Boolean)
  const { names: branches, sync } = parseTracking(branchRefs)
  const worktrees = worktreeText.split('\0\0').filter(Boolean).map(record => {
    const fields = record.split('\0')
    return { path: fields.find(field => field.startsWith('worktree '))?.slice(9), branch: fields.find(field => field.startsWith('branch '))?.replace(/^branch refs\/heads\//, '') || (fields.includes('detached') ? 'HEAD separado' : 'Sin rama'), bare: fields.includes('bare') }
  }).filter(worktree => worktree.path && !worktree.bare)
  const stashes = stashLog.split('\x1e').map(x => x.trimStart()).filter(Boolean).map(record => {
    const [hash, parents, stash, subject, author, date, email, message] = record.split('\x1f')
    return { hash, parents: parents ? parents.split(' ') : [], stash, refs: [], subject, author, date, email, message: (message || subject).trimEnd() }
  })
  return { root, branch, head, changes, commits, limit: pageLimit(limit), hasMore, stashes, remotes, branches, sync, worktrees }
}
app.whenReady().then(() => {
  const projects = createProjectStore(path.join(app.getPath('userData'), 'projects.json'))
  const settings = createSettingsStore(path.join(app.getPath('userData'), 'settings.json'))
  ipcMain.handle('settings:read', () => settings.read())
  ipcMain.handle('settings:set', (_event, key, value) => settings.set(key, value))
  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:status', async (_event, paths) => {
    if (!Array.isArray(paths) || paths.length > 200 || !paths.every(item => typeof item === 'string')) throw new Error('Proyectos no válidos')
    const known = new Set((await projects.list()).projects.map(item => item.path))
    const entries = await Promise.all(paths.filter(item => known.has(item)).map(async dir => {
      try {
        const [status, counts] = await Promise.all([
          git(dir, ['status', '--porcelain=v1', '--untracked-files=normal', '-z']),
          git(dir, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => '0\t0'),
        ])
        const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
        return [dir, { dirty: status.split('\0').filter(Boolean).length, ahead: ahead || 0, behind: behind || 0 }]
      } catch { return [dir, null] }
    }))
    return Object.fromEntries(entries.filter(([, value]) => value))
  })
  ipcMain.handle('projects:default', (_event, project) => {
    if (project !== null && typeof project !== 'string') throw new Error('Proyecto no válido')
    return projects.setDefault(project)
  })
  ipcMain.handle('folders:create', (_event, name) => projects.createFolder(name))
  ipcMain.handle('folders:rename', (_event, id, name) => projects.renameFolder(id, name))
  ipcMain.handle('folders:reorder', (_event, ids) => projects.reorderFolders(ids))
  ipcMain.handle('folders:delete',(_event, id) => projects.deleteFolder(id))
  ipcMain.handle('projects:move', (_event, project, folderId) => projects.moveProject(project, folderId))
  ipcMain.handle('projects:reorder', (_event, paths) => projects.reorder(paths))
  ipcMain.handle('projects:command:set', (_event, project, command) => projects.setCommand(project, command))
  ipcMain.handle('projects:appearance:set', (_event, project, appearance) => projects.setAppearance(project, appearance || {}))
  ipcMain.handle('projects:command:run', async (_event, project, worktree) => {
    if (typeof project !== 'string' || typeof worktree !== 'string') throw new Error('Proyecto o worktree no válido')
    const state = await projects.list()
    const entry = state.projects.find(item => path.resolve(item.path).toLowerCase() === path.resolve(project).toLowerCase())
    if (!entry) throw new Error('El proyecto ya no está en la lista')
    if (!entry.command?.trim()) throw new Error('Configura un comando para este proyecto en Ajustes')
    const root = (await git(worktree, ['rev-parse', '--show-toplevel'])).trim()
    if (path.resolve(root).toLowerCase() !== path.resolve(worktree).toLowerCase()) throw new Error('El worktree seleccionado ya no está disponible')
    const worktrees = await git(root, ['worktree', 'list', '--porcelain', '-z'])
    const sameProject = worktrees.split('\0').some(field => field.startsWith('worktree ') && path.resolve(field.slice(9)).toLowerCase() === path.resolve(entry.path).toLowerCase())
    if (!sameProject) throw new Error('El worktree seleccionado ya no pertenece al proyecto')
    await launchProjectCommand({ command: entry.command, project: entry.path, worktree: root })
  })
  ipcMain.handle('projects:add', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled) return null
    const repo = await loadRepo(result.filePaths[0])
    const state = await projects.add(repo.root)
    return { repo, state }
  })
  ipcMain.handle('projects:open', async (_event, project, showRemote) => {
    if (typeof project !== 'string') throw new Error('Proyecto no válido')
    const state = await projects.list()
    const entry = state.projects.find(item => item.path === project)
    if (!entry) throw new Error('El proyecto ya no está en la lista')
    let repo
    try { repo = await loadRepo(entry.lastWorktree, showRemote !== false) } catch (error) {
      if (entry.lastWorktree === entry.path) throw error
      repo = await loadRepo(entry.path, showRemote !== false)
    }
    return { repo, state: await projects.activate(entry.path, repo.root) }
  })
  ipcMain.handle('projects:select', async (_event, project) => {
    if (typeof project !== 'string') throw new Error('Proyecto no válido')
    return projects.select(project)
  })
  ipcMain.handle('projects:worktree', async (_event, project, dir, showRemote) => {
    if (typeof project !== 'string' || typeof dir !== 'string') throw new Error('Worktree no válido')
    const state = await projects.list()
    if (!state.projects.some(item => item.path === project)) throw new Error('El proyecto ya no está en la lista')
    const projectRepo = await loadRepo(project, showRemote !== false)
    if (!projectRepo.worktrees.some(item => path.resolve(item.path!).toLowerCase() === path.resolve(dir).toLowerCase())) throw new Error('El worktree no pertenece al proyecto')
    const repo = await loadRepo(dir, showRemote !== false)
    return { repo, state: await projects.activate(project, repo.root) }
  })
  ipcMain.handle('projects:remove', (_event, project) => {
    if (typeof project !== 'string') throw new Error('Proyecto no válido')
    return projects.remove(project)
  })
  ipcMain.handle('repo:open', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return result.canceled ? null : loadRepo(result.filePaths[0]) })
  ipcMain.handle('repo:load', (_event, dir, showRemote, limit) => { if (typeof dir !== 'string') throw new Error('Ruta no válida'); return loadRepo(dir, showRemote !== false, limit) })
  ipcMain.handle('repo:history', (_event, dir, showRemote, limit) => { if (typeof dir !== 'string') throw new Error('Ruta no válida'); return loadHistory(dir, showRemote !== false, pageLimit(limit)) })
  ipcMain.handle('repo:commit-action', (_event, dir, request) => runCommitAction(dir, request))
  ipcMain.handle('repo:branches', (_event, dir) => branchesCommit.listBranches(dir))
  ipcMain.handle('repo:switch-branch', (_event, dir, ref) => branchesCommit.switchBranch(dir, ref))
  ipcMain.handle('repo:create-branch', (_event, dir, name) => branchesCommit.createBranch(dir, name))
  ipcMain.handle('repo:fetch', (_event, dir) => fetchRepo(dir))
  ipcMain.handle('repo:pull', (_event, dir) => pullRepo(dir))
  ipcMain.handle('repo:push', (_event, dir) => pushRepo(dir))
  ipcMain.handle('repo:stage', (_event, dir, paths) => staging.stagePaths(dir, paths))
  ipcMain.handle('repo:unstage', (_event, dir, paths) => staging.unstagePaths(dir, paths))
  ipcMain.handle('repo:working-diff', (_event, dir, request) => staging.workingDiff(dir, request))
  ipcMain.handle('repo:apply-hunk', (_event, dir, request) => staging.applyHunk(dir, request))
  ipcMain.handle('repo:last-message', (_event, dir) => staging.lastCommitMessage(dir))
  ipcMain.handle('repo:commit', (_event, dir, message, options) => branchesCommit.commitChanges(dir, message, { amend: options?.amend === true }))
  ipcMain.handle('repo:commit-push', (_event, dir, message, options) => branchesCommit.commitAndPush(dir, message, { amend: options?.amend === true }))
  ipcMain.handle('repo:discard', (_event, dir, paths) => staging.discardPaths(dir, paths))
  ipcMain.handle('repo:discard-hunk', (_event, dir, request) => staging.discardHunk(dir, request))
  ipcMain.handle('repo:rename-branch', (_event, dir, name, newName) => branchesCommit.renameBranch(dir, name, newName))
  ipcMain.handle('repo:delete-branch', (_event, dir, name, force) => branchesCommit.deleteBranch(dir, name, { force: force === true }))
  ipcMain.handle('repo:delete-remote-branch', (_event, dir, ref) => branchesCommit.deleteRemoteBranch(dir, ref))
  ipcMain.handle('repo:set-upstream', (_event, dir, name, ref) => branchesCommit.setUpstream(dir, name, ref))
  ipcMain.handle('repo:branch-op', async (_event, dir, type, ref) => {
    if (type !== 'archive') return branchesCommit.branchOperation(dir, type, ref)
    const result = await dialog.showSaveDialog({ defaultPath: `${String(ref).replace(/^refs\/(heads|remotes)\//, '').replace(/[\/:*?"<>|]/g, '-')}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] })
    if (result.canceled) return false
    await branchesCommit.branchOperation(dir, type, ref, { file: result.filePath }); return true
  })
  ipcMain.handle('repo:checkout-remote', (_event, dir, ref, name) => branchesCommit.checkoutRemote(dir, ref, name))
  ipcMain.handle('repo:stash-push', (_event, dir, options) => stash.stashPush(dir, { message: options?.message, includeUntracked: options?.includeUntracked === true, keepIndex: options?.keepIndex === true }))
  ipcMain.handle('repo:stash-apply', (_event, dir, hash) => stash.stashApply(dir, hash))
  ipcMain.handle('repo:stash-pop', (_event, dir, hash) => stash.stashPop(dir, hash))
  ipcMain.handle('repo:stash-drop', (_event, dir, hash) => stash.stashDrop(dir, hash))
  ipcMain.handle('repo:tags', (_event, dir) => tags.listTags(dir))
  ipcMain.handle('repo:create-tag', (_event, dir, request) => tags.createTag(dir, request))
  ipcMain.handle('repo:delete-tag', (_event, dir, name, options) => tags.deleteTag(dir, name, { remote: options?.remote === true, remoteName: options?.remoteName }))
  ipcMain.handle('repo:push-tag', (_event, dir, name, remote) => tags.pushTag(dir, name, remote))
  const tokenStore = createTokenStore(path.join(app.getPath('userData'), 'tokens.json'), safeStorage.isEncryptionAvailable() ? { encrypt: text => safeStorage.encryptString(text), decrypt: buffer => safeStorage.decryptString(buffer) } : undefined)
  ipcMain.handle('tokens:has', async (_event, dir) => tokenStore.has(await repoKey(dir)))
  ipcMain.handle('tokens:set', async (_event, dir, value) => tokenStore.set(await repoKey(dir), value))
  ipcMain.handle('repo:forge-info', (_event, dir) => issues.forgeInfo(dir))
  ipcMain.handle('repo:forge-list', async (_event, dir, kind, options) => issues.listResource(dir, kind, { state: options?.state, filters: options?.filters }, fetch, await tokenStore.get(await repoKey(dir))))
  ipcMain.handle('repo:forge-facets', async (_event, dir, kind) => issues.listFacets(dir, kind, fetch, await tokenStore.get(await repoKey(dir))))
  ipcMain.handle('app:open-issue', (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Enlace no válido')
    return shell.openExternal(url)
  })
  const agentRuns = new Map()
  const agentStore = createAgentStore(path.join(app.getPath('userData'), 'agent-chats.json'))
  ipcMain.handle('agent:load', (_event, dir) => agentStore.load(dir))
  ipcMain.handle('agent:save', (_event, dir, data) => agentStore.save(dir, data))
  ipcMain.handle('agent:send', (event, dir, request) => {
    const id = typeof request?.id === 'string' && /^[\w-]{6,64}$/.test(request.id) && !agentRuns.has(request.id) ? request.id : String(Date.now()) + Math.random().toString(36).slice(2, 8), sender = event.sender
    const emit = payload => { if (!sender.isDestroyed()) sender.send('agent:event', id, payload); if (payload.type === 'done') agentRuns.delete(id) }
    agentRuns.set(id, agentChat.runAgent(dir, { prompt: request?.prompt, sessionId: request?.sessionId, mode: request?.mode, model: request?.model, effort: request?.effort }, emit))
    return id
  })
  ipcMain.handle('agent:cancel', (_event, id) => { agentRuns.get(id)?.cancel() })
  ipcMain.handle('repo:generate-message', (_event, dir) => branchesCommit.generateCommitMessage(dir))
  ipcMain.handle('repo:diff', async (_event, dir, hash) => {
    if (typeof dir !== 'string' || !/^[a-f0-9]{40,64}$/i.test(hash)) throw new Error('Commit no válido')
    return git(dir, ['-c', 'core.quotepath=false', 'show', '--format=', '--no-ext-diff', '--no-textconv', '--stat', '--patch', '--first-parent', hash, '--']) + await stash.stashExtras(dir, hash, ['--stat', '--patch'])
  })
  ipcMain.handle('repo:commit-files', async (_event, dir, hash) => {
    if (typeof dir !== 'string' || !/^[a-f0-9]{40,64}$/i.test(hash)) throw new Error('Commit no válido')
    return parseNumstat(await git(dir, ['-c', 'core.quotepath=false', 'show', '--format=', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', '--first-parent', hash, '--']) + await stash.stashExtras(dir, hash, ['--no-renames', '--numstat', '-z']))
  })
  ipcMain.handle('repo:file-history', (_event, dir, file, rev) => fileHistory.fileHistory(dir, file, rev))
  ipcMain.handle('repo:file-blame', (_event, dir, file, rev) => fileHistory.fileBlame(dir, file, rev))
  // Leave the last pixel of the 36px app bar outside the native overlay so its bottom border remains visible.
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#1e1e1e', icon: path.join(__dirname, app.isPackaged ? '../dist/icon.png' : '../public/icon.png'), title: 'Git Glam', autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#1c1d21', symbolColor: '#cccccc', height: 35 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else if (!app.isPackaged && process.argv.includes('--dev')) win.loadURL('http://127.0.0.1:5173')
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
})
app.on('window-all-closed', () => app.quit())
