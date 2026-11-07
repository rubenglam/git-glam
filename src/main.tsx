import { Conflicts } from './components/conflicts'
import { installModalFocus } from './lib/modal-focus.ts'
import { UpdateNotice, UpdateToast, startUpdateChecks } from './components/app-updater.tsx'
import { migrateElectronUi } from './bridge/tauri-bridge.ts'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, Bot, BotMessageSquare, Lightbulb, CircleAlert, CircleCheck, CircleDot, ChevronsDownUp, ChevronsUpDown, File, FolderOpen, Github, GitBranch, GitMerge, LoaderCircle, PanelLeft, PanelRight, RefreshCw, Search, Settings, SquareTerminal, X } from 'lucide-react'
import { layout, orderHistory } from './lib/graph-layout.ts'
import type { DiffState, GraphRow } from './types.ts'
import { graphSegments } from './lib/graph-segments.ts'
import { useBackgroundRefresh, useRefreshShortcut, useSearchShortcuts } from './hooks/app-effects.ts'
import { applySetting } from './lib/settings-flow.ts'
import { openUncachedProject } from './lib/project-flow.ts'
import { useProjects } from './hooks/use-projects.ts'
import { applyChange, refreshCachedProject, runSync, updatedSelection } from './lib/repo-flow.ts'
import { GRAPH_PALETTES, clamp, color, date } from './lib/format.ts'
import { useStoredState } from './hooks/use-stored-state.ts'
import { ColumnResize, PANEL_MIN, PanelSeparator } from './components/panel-resize.tsx'
import { CommitList } from './components/commit-list.tsx'
import { ProjectsPage } from './components/projects-page.tsx'
import { SyncBar } from './components/sync-bar.tsx'
import { ProjectTabs } from './components/project-tabs.tsx'

const isDevelopmentBuild = import.meta.env.DEV
const appIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
if (appIcon) appIcon.href = isDevelopmentBuild ? '/logo-dev.svg' : '/logo.svg'
import { CommitActionDialog, CommitMenu } from './components/commit-actions.tsx'
import { CommitDetails } from './components/commit-details.tsx'
import { FileHistoryDialog, FileMenu } from './components/file-history.tsx'
import { SettingsPage } from './components/settings.tsx'
import { BranchPicker, CommitBox } from './components/branch-picker.tsx'
import { ContextMenu } from './components/dialogs.tsx'
import { ProjectIcon, PROJECT_COLORS, projectName, colorClasses } from './components/project-icons.tsx'
import { ForgeDialog, prefetchForge } from './components/issues.tsx'
import { AgentDialog } from './components/agent-chat.tsx'
import { ImprovementsDialog } from './components/improvements.tsx'
import { ManageDialog, branchItems, graphBranchItems, stashItems, tagItems } from './components/manage.tsx'
import { ChangesList, isStaged, isUnstaged } from './components/changes-list.tsx'
import { WorkingDiff } from './components/working-diff.tsx'
import { Explorer } from './components/explorer.tsx'
import { DocumentationFilter } from './components/documentation-filter.tsx'
import { DocumentationFiles } from './components/documentation-files.tsx'
import { AiFiles } from './components/ai-files.tsx'
import { RepositoryFiles } from './components/repository-files.tsx'
import { FileViewer } from './components/file-viewer.tsx'
import lightStyles from './styles/style.css?inline'
import darkStyles from './styles/style-dark.css?inline'

installModalFocus()

const themeStyles = document.createElement('style')
themeStyles.textContent = darkStyles
document.head.appendChild(themeStyles)

const HISTORY_PAGE = 500
const GRAPH_MIN = 360
const HANDLE_SIZE = 6

function App() {
  const [repo, setRepo] = useState<any>(null), [selected, setSelected] = useState<any>(null), [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false), [filter, setFilter] = useState('all'), [showRemote, setShowRemote] = useState(true), [diff, setDiff] = useState<DiffState>({ text: '' }), [error, setError] = useState<string | null>(''), [busy, setBusy] = useState(false)
  const [viewedFile, setViewedFile] = useState<{ root: string, path: string, documentation?: boolean } | null>(null)
  const [documentationQuestion, setDocumentationQuestion] = useState<string | undefined>()
  const [documentationFolders, setDocumentationFolders] = useState<string[]>([])
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [filesRevision, setFilesRevision] = useState(0)
  const [explorerIconsOnly, setExplorerIconsOnly] = useState(false)
  const [explorerTab, setExplorerTab] = useState<'git' | 'files' | 'docs' | 'ai'>('git')
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true), [groupTabs, setGroupTabs] = useState(false), [showUngroupedLabel, setShowUngroupedLabel] = useState(false), [tabLabelWidth, setTabLabelWidth] = useState(220), [autoFetchMinutes, setAutoFetchMinutes] = useState(0), [layoutDensity, setLayoutDensity] = useState('comfortable'), [syncing, setSyncing] = useState<any>(null), [branchesOpen, setBranchesOpen] = useState(true), [worktreesOpen, setWorktreesOpen] = useState(true), [stashesOpen, setStashesOpen] = useState(true), [selectedChange, setSelectedChange] = useState<any>(null), [menu, setMenu] = useState<any>(null)
  const { projects, setProjects, folders, setFolders, activeProject, setActiveProject, defaultProject, setDefaultProject, showProjects, setShowProjects, statuses, visibleProjects,
    hideTab, hideFolder, setDefault, toggleDefault, folderAction, moveProject, moveTab, saveAppearance: saveProjectAppearance, saveCommand: saveProjectCommand, reorderTabs, reorderFolders } =
    useProjects({ setBusy, setError: setError as (message: string) => void, groupTabs, repoVersion: repo })
  const [theme, setTheme] = useState('dark'), [branchPalette, setBranchPalette] = useState<any>({ preset: 'classic', custom: ['#009ce9', '#e30094', '#00d625', '#e69a00', '#aa00e8', '#ee4c4c', '#00cabc'] })
  useLayoutEffect(() => { themeStyles.textContent = theme === 'light' ? lightStyles : darkStyles }, [theme])
  const [showSettings, setShowSettings] = useState(false)
  useEffect(() => startUpdateChecks(), [])
  const [settingsSection, setSettingsSection] = useState('general'), [launchingCommand, setLaunchingCommand] = useState(false)
  const [loadingProject, setLoadingProject] = useState<any>(null), [refreshingProject, setRefreshingProject] = useState<any>(null)
  const [fileMenu, setFileMenu] = useState<any>(null), [fileHistory, setFileHistory] = useState<any>(null)
  const closeFileMenu = useCallback(() => setFileMenu(null), [])
  const [commitMenu, setCommitMenu] = useState<any>(null), [action, setAction] = useState<any>(null), [actionError, setActionError] = useState<string | null>(''), [notice, setNotice] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [checkoutVisible, setCheckoutVisible] = useState(false), checkoutRunning = useRef(false)
  const [fileReview, setFileReview] = useState<any>(null)
  const [improveOpen, setImproveOpen] = useState(false), [manage, setManage] = useState<any>(null), [manageMenu, setManageMenu] = useState<any>(null), [tags, setTags] = useState<any[]>([]), [tagsOpen, setTagsOpen] = useState(false), [remotesOpen, setRemotesOpen] = useState(false), [remoteBranches, setRemoteBranches] = useState<any[]>([]), [branchDates, setBranchDates] = useState<Record<string, string>>({}), [issuesOpen, setIssuesOpen] = useState(false), [agentOpen, setAgentOpen] = useState(false)
  const closeManageMenu = useCallback(() => setManageMenu(null), [])
  const settingVersions = useRef({}), [loadingMore, setLoadingMore] = useState(false), loadMoreRef = useRef(false), loadMoreFailed = useRef(-1)
  const projectCache = useRef(new Map()), projectRequest = useRef(0)
  const openCommitMenu = useCallback((commit, x, y, origin) => setCommitMenu({ commit, x, y, origin }), [])
  const closeCommitMenu = useCallback(() => setCommitMenu(null), [])
  const workspaceRef = useRef<any>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth)
  const [leftWidth, setLeftWidth] = useStoredState('gitgraph.leftWidth', 235), [rightWidth, setRightWidth] = useStoredState('gitgraph.rightWidth', 260)
  const [columnWidths, setColumnWidths] = useStoredState('gitgraph.columnWidths', {})
  const [storedPanelOrder, setPanelOrder] = useStoredState('gitgraph.panelOrder', (() => { try { return JSON.parse(localStorage.getItem('gitgraph.panelsSwapped') || 'false') === true ? ['changes', 'graph', 'branches'] : ['branches', 'graph', 'changes'] } catch { return ['branches', 'graph', 'changes'] } })())
  const panelOrder = Array.isArray(storedPanelOrder) && storedPanelOrder.length === 3 && ['branches', 'graph', 'changes'].every(item => storedPanelOrder.includes(item)) ? storedPanelOrder : ['branches', 'graph', 'changes']
  const panelPosition = name => panelOrder.indexOf(name) * 3
  const panelSide = name => panelPosition(name) < panelPosition('graph') ? 'left' : 'right'
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWorkspaceWidth(entries[0].contentRect.width))
    if (workspaceRef.current) observer.observe(workspaceRef.current)
    return () => observer.disconnect()
  }, [])
  const available = Math.max(0, workspaceWidth - GRAPH_MIN - (Number(leftOpen) + Number(rightOpen)) * HANDLE_SIZE)
  const displayedLeft = leftOpen ? Math.min(leftWidth, Math.max(PANEL_MIN, available - (rightOpen ? PANEL_MIN : 0))) : 0
  const displayedRight = rightOpen ? Math.min(rightWidth, Math.max(PANEL_MIN, available - displayedLeft)) : 0
  const maxLeft = Math.max(PANEL_MIN, available - displayedRight)
  const maxRight = Math.max(PANEL_MIN, available - displayedLeft)
  // Warm the issues/PRs/milestones cache for the open project and keep it fresh in the background.
  const repoRoot = repo?.root
  useEffect(() => {
    if (!repoRoot) return
    prefetchForge(repoRoot)
    const timer = setInterval(() => prefetchForge(repoRoot), 5 * 60_000)
    return () => clearInterval(timer)
  }, [repoRoot])
  const isRemote = name => (repo?.remotes || []).some(remote => name.replace(/^HEAD -> /, '').startsWith(remote + '/'))
  const rows = useMemo(() => repo ? layout(orderHistory(repo.commits)) : [], [repo])
  const graphAutoWidth = useMemo(() => rows.reduce((width, row) => Math.max(width, 35 + 18 * Math.max(row.col, row.before.length - 1, row.after.length - 1)), 55), [rows])
  const widths = { graph: 0, date: 125, author: 100, hash: 75, ...columnWidths }
  const graphWidth = Number.isFinite(widths.graph) && widths.graph >= 40 ? widths.graph : graphAutoWidth
  const columnStyle = { '--graph-width': `${graphWidth}px`, '--date-width': `${clamp(Number(widths.date) || 125, 50, 600)}px`, '--author-width': `${clamp(Number(widths.author) || 100, 50, 600)}px`, '--hash-width': `${clamp(Number(widths.hash) || 75, 50, 600)}px` } as React.CSSProperties
  const refs = useMemo<string[]>(() => [...new Set<string>((repo?.commits || []).flatMap(c => c.refs).filter(r => !r.startsWith('tag: ') && (showRemote || !isRemote(r))).map(r => r.replace(/^HEAD -> /, '')))], [repo, showRemote])
  const visibleHashes = useMemo(() => {
    if (filter === 'all') return null
    const start = repo?.commits.find(c => c.refs.some(r => r.replace(/^HEAD -> /, '') === filter))
    const byHash = new Map<string, any>(repo?.commits.map(c => [c.hash, c]) || []), result = new Set<string>(), stack: string[] = start ? [start.hash] : []
    while (stack.length) { const hash = stack.pop()!; if (result.has(hash)) continue; result.add(hash); stack.push(...(byHash.get(hash)?.parents || [])) }
    return result
  }, [repo, filter])
  async function load(open = false, remote = showRemote) {
    if (!open && !repo) return
    ++projectRequest.current
    setRefreshingProject(null)
    setBusy(true); setError('')
    try {
      const added = open ? await window.gitGraph.projects.add() : null
      if (open && !added) return
      if (added) { setProjects(added.state.projects); setActiveProject(added.state.activeProject) }
      let data = added ? added.repo : await window.gitGraph.load(repo.root, remote, repo.commits.length)
      if (added && !remote) data = await window.gitGraph.load(data.root, false)
      if (data) { projectCache.current.set(added?.state.activeProject || activeProject, { repo: data, showRemote: remote }); setRepo(data); setSelected(old => updatedSelection(data, old)); if (open) { setFilter('all'); setQuery(''); setShowProjects(false) } }
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  const openManageMenu = (items, event) => setManageMenu({ items, x: event.clientX, y: event.clientY })
  const openRef = useCallback(async name => {
    if (!repo || busy || checkoutRunning.current || name === repo.branch) return
    try {
      const remote = repo.remotes.some(item => name.startsWith(item + '/'))
      if (remote && name.slice(name.indexOf('/') + 1) === repo.branch) return
      checkoutRunning.current = true; setBusy(true); setError(''); setCheckoutVisible(true)
      await window.gitGraph.switchBranch(repo.root, (remote ? 'refs/remotes/' : 'refs/heads/') + name)
      await load()
    } catch (e) { setError(e.message || String(e)) } finally { checkoutRunning.current = false; setBusy(false); setCheckoutVisible(false) }
  }, [repo, busy, load])
  const copyTag = useCallback(async (name: string) => {
    try { await navigator.clipboard.writeText(name); setNotice('Copiado al portapapeles') }
    catch (e) { setError(`No se pudo copiar: ${e.message || String(e)}`) }
  }, [])
  const openRefMenu = useCallback(async (name, event) => {
    if (!repo) return
    if (name.startsWith('tag: ')) { openManageMenu(tagItems({ name: name.slice(5) }, setManage, copyTag), event); return }
    const point = { clientX: event.clientX, clientY: event.clientY }
    try {
      const { branches } = await window.gitGraph.branches(repo.root)
      const branch = branches.find(item => item.name === name)
      if (!branch) return
      const direct = async (type, target) => {
        try {
          if (type === 'copy') { await navigator.clipboard.writeText(target.name); setNotice('Copiado al portapapeles'); return }
          if (type === 'checkout') { await window.gitGraph.switchBranch(repo.root, target.ref); await load(); return }
          if (await window.gitGraph.branchOp(repo.root, type, target.ref)) setNotice('Archivo creado')
        } catch (e) { setError(e.message || String(e)) }
      }
      openManageMenu(graphBranchItems(branch, { current: repo.branch, tracking: Boolean(repo.sync?.[branch.name]) }, setManage, direct), point)
    } catch (e) { setError(e.message || String(e)) }
  }, [repo, load, copyTag])
  const toggleSection = section => ({ branches: () => setBranchesOpen(v => !v), remotes: () => setRemotesOpen(v => !v), worktrees: () => setWorktreesOpen(v => !v), stashes: () => setStashesOpen(v => !v), tags: () => setTagsOpen(v => !v) })[section]()
  const setAllSections = value => { setBranchesOpen(value); setRemotesOpen(value); setWorktreesOpen(value); setStashesOpen(value); setTagsOpen(value) }
  useEffect(() => {
    if (!repo || !leftOpen) return
    let active = true
    window.gitGraph.branches(repo.root).then(({ branches }) => {
      if (!active) return
      setRemoteBranches(branches.filter(item => item.remote))
      setBranchDates(Object.fromEntries(branches.filter(item => !item.remote && item.date).map(item => [item.name, item.date])))
    }).catch(() => { if (active) { setRemoteBranches([]); setBranchDates({}) } })
    return () => { active = false }
  }, [repo, leftOpen])
  useEffect(() => {
    if (!repo || !tagsOpen) return
    let active = true
    window.gitGraph.tags(repo.root).then(list => { if (active) setTags(list) }).catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [repo, tagsOpen])
  const staging = useRef(false)
  async function changeAction(task) {
    if (!repo || staging.current) return
    staging.current = true
    const failure = await applyChange(repo.root, task, () => load())
    staging.current = false
    if (failure) setError(failure)
  }
  const branchSync = repo?.sync?.[repo.branch]
  const publishedTo = branchSync && !branchSync.gone && !branchSync.ahead ? branchSync.upstream : null
  useEffect(() => {
    if (!selectedChange) return
    if (!repo || !repo.changes.some(change => change.path === selectedChange.path && (selectedChange.staged ? isStaged(change) : isUnstaged(change)))) setSelectedChange(null)
  }, [repo, selectedChange])
  async function syncAction(kind) {
    if (!repo || busy) return
    ++projectRequest.current
    setRefreshingProject(null)
    setBusy(true); setSyncing(kind); setError(''); setNotice('')
    const { root } = repo
    const { notice: syncNotice, failure } = await runSync(window.gitGraph, root, kind, showRemote, repo.commits.length)
    if (syncNotice) setNotice(syncNotice)
    if (failure) setError(failure)
    try {
      const data = await window.gitGraph.load(root, showRemote, repo.commits.length)
      projectCache.current.set(activeProject, { repo: data, showRemote }); setRepo(data); setSelected(old => updatedSelection(data, old))
    } catch (e) { if (!failure) setError('No se pudo actualizar el repositorio: ' + (e.message || String(e))) }
    finally { setBusy(false); setSyncing(null) }
  }
  const loadMore = useCallback(async () => {
    if (!repo || !repo.hasMore || loadMoreRef.current || loadMoreFailed.current === repo.commits.length) return
    loadMoreRef.current = true; setLoadingMore(true)
    const { root } = repo, request = projectRequest.current
    try {
      const page = await window.gitGraph.history(root, showRemote, repo.commits.length + HISTORY_PAGE)
      if (request !== projectRequest.current) return
      setRepo(old => {
        if (!old || old.root !== root) return old
        const next = { ...old, commits: page.commits, limit: page.limit, hasMore: page.hasMore }
        if (activeProject) projectCache.current.set(activeProject, { repo: next, showRemote })
        return next
      })
    } catch (e) { loadMoreFailed.current = repo.commits.length; setError(`No se pudo cargar más historial: ${e.message || String(e)}`) }
    finally { loadMoreRef.current = false; setLoadingMore(false) }
  }, [repo, showRemote, activeProject])
  async function openProject(path, remote = showRemote) {
    if (path === activeProject && repo && !showProjects) return
    const request = ++projectRequest.current
    const cached = projectCache.current.get(path)
    if (cached && cached.showRemote === remote) {
      setError(''); setLoadingProject(null); setRefreshingProject(path); setActiveProject(path); setRepo(cached.repo); setSelected(null); setFilter('all'); setQuery(''); setShowProjects(false)
      const outcome = await refreshCachedProject(window.gitGraph, path, cached, remote, () => request === projectRequest.current)
      if (!outcome) return
      setRefreshingProject(null)
      if (outcome.selectionError) setError(outcome.selectionError)
      if (outcome.repo) {
        projectCache.current.set(path, { repo: outcome.repo, showRemote: remote })
        setRepo(outcome.repo); setSelected(old => updatedSelection(outcome.repo, old))
      } else if (outcome.refreshError) setError(outcome.refreshError)
      return
    }
    setBusy(true); setError(''); setRefreshingProject(null); setLoadingProject(path)
    setActiveProject(path); setRepo(null); setSelected(null); setFilter('all'); setQuery(''); setShowProjects(false)
    const outcome = await openUncachedProject(window.gitGraph.projects, path, remote, () => request === projectRequest.current)
    if (!outcome) return
    if ('result' in outcome) {
      const { result } = outcome
      projectCache.current.set(path, { repo: result.repo, showRemote: remote })
      setProjects(result.state.projects); setActiveProject(result.state.activeProject); setRepo(result.repo); setSelected(null); setFilter('all'); setQuery(''); setShowProjects(false)
    } else setError(outcome.error)
    setLoadingProject(null); setBusy(false)
  }
  async function removeProject(path) {
    ++projectRequest.current
    setRefreshingProject(null)
    setBusy(true); setError('')
    try {
      const state = await window.gitGraph.projects.remove(path)
      projectCache.current.delete(path); setProjects(state.projects); setActiveProject(state.activeProject); setDefaultProject(state.defaultProject)
      if (activeProject === path) { setRepo(null); setSelected(null); setFilter('all'); setShowProjects(true) }
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  async function runProjectCommand() {
    if (!repo || !activeProject || busy || launchingCommand) return
    const project = projects.find(item => item.path === activeProject)
    if (!project?.command?.trim()) { setSettingsSection('projects'); setShowSettings(true); return }
    setLaunchingCommand(true); setError(''); setNotice('')
    try { await window.gitGraph.projects.runCommand(activeProject, repo.root); setNotice('PowerShell abierto en el worktree seleccionado.') }
    catch (error) { setError(error.message || String(error)) }
    finally { setLaunchingCommand(false) }
  }
  const [aiSettings, setAISettings] = useState({ showAI: true, showAIAgent: true, showAIReview: true, showAICommit: true, showAIImprovements: true, agentModel: 'claude-sonnet-5-5', chatModel: '', summaryModel: 'claude-haiku-5-5', reviewModel: '', commitModel: 'claude-haiku-5-5', improvementsModel: '' })
  async function changeSetting(key, value) {
    const setters: Record<string, [unknown, (value: any) => void]> = {
      explorerIconsOnly: [explorerIconsOnly, setExplorerIconsOnly], leftOpen: [leftOpen, setLeftOpen], rightOpen: [rightOpen, setRightOpen],
      groupTabs: [groupTabs, setGroupTabs], showUngroupedLabel: [showUngroupedLabel, setShowUngroupedLabel], tabLabelWidth: [tabLabelWidth, setTabLabelWidth],
      autoFetchMinutes: [autoFetchMinutes, setAutoFetchMinutes], layoutDensity: [layoutDensity, setLayoutDensity], theme: [theme, setTheme], branchPalette: [branchPalette, setBranchPalette],
      showRemote: [showRemote, setShowRemote],
    }
    const [current, set] = key in aiSettings ? [aiSettings[key], (next: unknown) => setAISettings(old => ({ ...old, [key]: next }))] : setters[key] ?? [undefined, () => {}]
    if (key === 'showRemote') { ++projectRequest.current; setRefreshingProject(null); setBusy(true); setFilter('all') }
    try {
      const failure = await applySetting(settingVersions.current, key, { value: current, set }, value, async () => {
        await window.gitGraph.settings.set(key, value)
        if (key === 'showRemote' && repo) await load(false, value)
      })
      if (failure) setError(failure)
    } finally { if (key === 'showRemote') setBusy(false) }
  }
  async function selectWorktree(path) {
    if (path === repo.root || busy) return
    ++projectRequest.current
    setRefreshingProject(null)
    setBusy(true); setError('')
    try { const result = await window.gitGraph.projects.worktree(activeProject, path, showRemote); projectCache.current.set(activeProject, { repo: result.repo, showRemote }); setProjects(result.state.projects); setRepo(result.repo); setSelected(null); setFilter('all'); setQuery('') } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  async function chooseCommitAction(type, commit) {
    setCommitMenu(null)
    if (type === 'copy-hash' || type === 'copy-subject') {
      try { await navigator.clipboard.writeText(type === 'copy-hash' ? commit.hash : commit.subject); setNotice('Copiado al portapapeles') } catch (e) { setError(`No se pudo copiar: ${e.message || String(e)}`) }
      return
    }
    setActionError(''); setAction({ type, commit, root: repo.root, head: repo.head, branch: repo.branch })
  }
  async function executeCommitAction(options) {
    ++projectRequest.current
    setRefreshingProject(null)
    setBusy(true); setActionError(''); setNotice('')
    let failure: string | null = null
    try {
      const output = await window.gitGraph.commitAction(action.root, { type: action.type, hash: action.commit.hash, expectedHead: action.head, expectedBranch: action.branch, ...options })
      setNotice(output || 'Operación completada'); setAction(null)
    } catch (e) { failure = e.message || String(e); setActionError(failure); try { const conflict = await window.gitGraph.conflictState(action.root); if (conflict.operation || conflict.files.length) { setAction(null); setNotice('La operación quedó en curso. Resuelve los conflictos para continuar.') } } catch {} }
    try {
      const data = await window.gitGraph.load(action.root, showRemote, repo.commits.length)
      projectCache.current.set(activeProject, { repo: data, showRemote }); setRepo(data); setSelected(old => updatedSelection(data, old))
    } catch (e) { if (failure) setActionError(failure + '\n\nNo se pudo actualizar el repositorio: ' + (e.message || String(e))); else setError('Operación completada, pero no se pudo actualizar: ' + (e.message || String(e))) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    Promise.allSettled([window.gitGraph.projects.list(), window.gitGraph.settings.read()]).then(async ([projectResult, settingResult]) => {
      if (cancelled) return
      const settings = settingResult.status === 'fulfilled' ? settingResult.value : { showRemote: true, leftOpen: true, rightOpen: true, groupTabs: false, showUngroupedLabel: false, tabLabelWidth: 220, autoFetchMinutes: 0, layoutDensity: 'comfortable' }
      if (settingResult.status === 'rejected') setError(settingResult.reason?.message || String(settingResult.reason))
      setAISettings(old => Object.fromEntries(Object.keys(old).map(key => [key, settings[key] ?? old[key]])) as typeof old)
      setExplorerIconsOnly(settings.explorerIconsOnly === true); setTheme(settings.theme === 'light' ? 'light' : 'dark'); if (settings.branchPalette && typeof settings.branchPalette === 'object') setBranchPalette(settings.branchPalette); setShowRemote(settings.showRemote); setLeftOpen(settings.leftOpen); setRightOpen(settings.rightOpen); setGroupTabs(settings.groupTabs === true); setShowUngroupedLabel(settings.showUngroupedLabel === true); setTabLabelWidth(Number.isInteger(settings.tabLabelWidth) ? settings.tabLabelWidth : 220); setAutoFetchMinutes(Number.isInteger(settings.autoFetchMinutes) ? settings.autoFetchMinutes : 0); setLayoutDensity(settings.layoutDensity === 'compact' ? 'compact' : 'comfortable')
      if (projectResult.status === 'rejected') throw projectResult.reason
      const state = projectResult.value
      setProjects(state.projects); setFolders(state.folders || []); setDefaultProject(state.defaultProject)
      if (state.defaultProject) {
        setActiveProject(state.defaultProject); setLoadingProject(state.defaultProject); setShowProjects(false)
        try { const result = await window.gitGraph.projects.open(state.defaultProject, settings.showRemote); if (!cancelled) { projectCache.current.set(result.state.activeProject, { repo: result.repo, showRemote: settings.showRemote }); setProjects(result.state.projects); setActiveProject(result.state.activeProject); setRepo(result.repo) } }
        catch (e) { if (!cancelled) { setShowProjects(true); setActiveProject(null); setError(`No se pudo abrir el proyecto predeterminado «${state.defaultProject}»: ${e.message || String(e)}`) } }
      }
    }).catch(e => { if (!cancelled) setError(e.message || String(e)) }).finally(() => { if (!cancelled) { setLoadingProject(null); setBusy(false) } })
    return () => { cancelled = true }
  }, [])
  useBackgroundRefresh({
    state: { repo, busy, showRemote, activeProject }, request: projectRequest, autoFetchMinutes, paused: showProjects || showSettings,
    onRefreshed: (data, state) => { projectCache.current.set(state.activeProject, { repo: data, showRemote: state.showRemote }); setRepo(data); setSelected(old => updatedSelection(data, old)) },
    onError: setError,
  })
  useRefreshShortcut(() => { void load() }, Boolean(repo) && !busy && !showProjects && !showSettings)
  useEffect(() => { if (!repo || !selected) { setDiff({ text: '' }); return }; let active = true; setDiff({ loading: true, text: '' }); window.gitGraph.diff(repo.root, selected.hash).then(value => { if (active) setDiff({ text: value }) }).catch(e => { if (active) setDiff({ text: '', error: 'No se pudo cargar el diff: ' + (e.message || e) }) }); return () => { active = false } }, [repo?.root, selected?.hash])
  useSearchShortcuts(showSettings, () => setSearchOpen(true), () => setSelected(null))
  return <main className="app" data-density={layoutDensity}>
    <div className={"appbar" + (isTauri() ? " tauri-appbar" : "")} data-tauri-drag-region><div className={"appbar-brand" + (isDevelopmentBuild ? " appbar-brand-dev" : "")} data-tauri-drag-region><img src={isDevelopmentBuild ? "./logo-dev.svg" : "./logo.svg"} width={18} height={18} alt=""/><strong>Git Glam</strong>{isDevelopmentBuild && <span className="dev-badge" title="Compilación local de desarrollo">DEV</span>}<UpdateNotice onOpen={() => { setSettingsSection('about'); setShowSettings(true) }}/><UpdateToast/></div><div className="app-menu"><button onClick={() => setMenu(menu === 'file' ? null : 'file')}>Archivo</button><button onClick={() => setMenu(menu === 'view' ? null : 'view')}>Ver</button><button onClick={() => setMenu(menu === 'help' ? null : 'help')}>Ayuda</button>{menu && <div className="menu-popup">{menu === 'file' && <><button onClick={() => { setMenu(null); load(true) }}>Abrir repositorio…</button><button onClick={() => { setMenu(null); setShowSettings(true) }}>Ajustes…</button></>}{menu === 'view' && <><button onClick={() => { changeSetting('leftOpen', !leftOpen); setMenu(null) }}>{leftOpen ? '✓ ' : ''}Panel de ramas</button><button onClick={() => { changeSetting('rightOpen', !rightOpen); setMenu(null) }}>{rightOpen ? '✓ ' : ''}Panel de cambios</button></>}{menu === 'help' && <div className="menu-info">Git Glam · Explorador de repositorios<br/>Pulsa / para buscar commits.</div>}</div>}</div><div className="appbar-center" data-tauri-drag-region title={repo?.root}>{repo ? repo.root.split(/[\\/]/).pop() + ' — Git Glam' : 'Git Glam'}</div><div className="appbar-panels"><button className="tool-button" title="Abrir repositorio en GitHub" aria-label="Abrir repositorio en GitHub" disabled={!repo} onClick={async () => { try { const info = await window.gitGraph.forgeInfo(repo.root); if (info.provider !== 'github') throw new Error('El repositorio no tiene un remoto de GitHub'); await window.gitGraph.openIssue(`https://github.com/${info.owner}/${info.repo}`) } catch (e) { setError(e.message || String(e)) } }}><Github size={16}/></button><button className="tool-button" title="Issues, solicitudes de cambio, milestones y CI" aria-label="Ver issues, solicitudes de cambio, milestones y CI" disabled={!repo} onClick={() => setIssuesOpen(true)}><CircleDot size={16}/></button>{aiSettings.showAI && aiSettings.showAIImprovements && <button className="tool-button" title="Pedir mejoras a la IA" aria-label="Pedir mejoras a la IA" disabled={!repo} onClick={() => setImproveOpen(true)}><Lightbulb size={16}/></button>}{aiSettings.showAI && aiSettings.showAIAgent && <button className="tool-button" title="Chat con agente" aria-label="Abrir chat con agente" disabled={!repo} onClick={() => setAgentOpen(true)}><BotMessageSquare size={18}/></button>}<button className="tool-button" title="Ajustes" aria-label="Abrir ajustes" onClick={() => setShowSettings(true)}><Settings size={16}/></button><button className="tool-button" title="Panel de ramas" aria-label="Mostrar u ocultar ramas" disabled={showProjects && !showSettings} onClick={() => changeSetting('leftOpen', !leftOpen)}><span className={"panel-icon left " + (leftOpen && !showProjects && !showSettings ? "panel-visible" : "")}><PanelLeft size={16}/></span></button><button className="tool-button" title="Panel de cambios" aria-label="Mostrar u ocultar cambios" disabled={showProjects && !showSettings} onClick={() => changeSetting('rightOpen', !rightOpen)}><span className={"panel-icon right " + (rightOpen && !showProjects && !showSettings ? "panel-visible" : "")}><PanelRight size={16}/></span></button></div>{isTauri() && <div className="window-controls"><button type="button" title="Minimizar" aria-label="Minimizar ventana" onClick={() => { void getCurrentWindow().minimize() }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10"/></svg></button><button type="button" title="Maximizar o restaurar" aria-label="Maximizar o restaurar ventana" onClick={() => { void getCurrentWindow().toggleMaximize() }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9"/></svg></button><button type="button" className="window-close" title="Cerrar" aria-label="Cerrar ventana" onClick={() => { void getCurrentWindow().close() }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9m0-9l-9 9"/></svg></button></div>}</div>
    {showSettings && <SettingsPage aiSettings={aiSettings} branchPalette={branchPalette} paletteOptions={GRAPH_PALETTES} panelOrder={panelOrder} onPanelOrder={setPanelOrder} onBack={() => setShowSettings(false)} projects={projects} activeProject={activeProject} defaultProject={defaultProject} onDefault={setDefault} showRemote={showRemote} leftOpen={leftOpen} rightOpen={rightOpen} explorerIconsOnly={explorerIconsOnly} groupTabs={groupTabs} showUngroupedLabel={showUngroupedLabel} tabLabelWidth={tabLabelWidth} autoFetchMinutes={autoFetchMinutes} layoutDensity={layoutDensity} theme={theme} busy={busy} onSetting={changeSetting} onSaveCommand={saveProjectCommand} onSaveAppearance={saveProjectAppearance} initialSection={settingsSection}/>}
    {!showSettings && <ProjectTabs onSaveAppearance={saveProjectAppearance}onHideFolder={hideFolder} onMoveTab={moveTab} groupTabs={groupTabs} showUngroupedLabel={showUngroupedLabel} tabLabelWidth={tabLabelWidth} folders={folders} statuses={statuses} projects={visibleProjects} savedProjects={projects} activeProject={activeProject} defaultProject={defaultProject} showProjects={showProjects} loadingProject={loadingProject} refreshingProject={refreshingProject} busy={busy} onProjects={() => setShowProjects(true)} onOpen={openProject} onAdd={() => load(true)} onReorder={reorderTabs} onReorderFolders={reorderFolders} onClose={hideTab}/>}
    {!showSettings && showProjects && <ProjectsPage projects={projects} folders={folders} defaultProject={defaultProject} busy={busy} onAdd={() => load(true)} onOpen={openProject} onDefault={toggleDefault} onRemove={removeProject} onFolderAction={folderAction} onMove={moveProject}/>}
    <div className="workspace" ref={workspaceRef} style={{ display: showProjects || showSettings ? 'none' : undefined }}>
    {leftOpen && <aside id="branches-panel" className="left-panel" style={{ width: displayedLeft, order: panelPosition('branches') }}><div className={'explorer-tabs' + (explorerIconsOnly ? ' icons-only' : '')} role="tablist" aria-label="Tipo de explorador"><button role="tab" aria-selected={explorerTab === 'git'} aria-controls="git-explorer" className={explorerTab === 'git' ? 'active' : ''} title="Explorador de Git" aria-label="Explorador de Git" onClick={() => setExplorerTab('git')}><GitBranch size={15}/><span>Git</span></button><button role="tab" aria-selected={explorerTab === 'files'} aria-controls="file-explorer" className={explorerTab === 'files' ? 'active' : ''} title="Explorador de archivos" aria-label="Explorador de archivos" onClick={() => setExplorerTab('files')}><File size={15}/><span>Archivos</span></button><button role="tab" aria-selected={explorerTab === 'docs'} aria-controls="documentation-explorer" className={explorerTab === 'docs' ? 'active' : ''} title="Documentación" aria-label="Documentación" onClick={() => setExplorerTab('docs')}><BookOpen size={15}/><span>Docs</span></button><button role="tab" aria-selected={explorerTab === 'ai'} aria-controls="ai-explorer" className={explorerTab === 'ai' ? 'active' : ''} title="IA y agentes" aria-label="IA y agentes" onClick={() => setExplorerTab('ai')}><Bot size={15}/><span>IA</span></button></div><div className="panel-header">{explorerTab === 'git' ? 'EXPLORADOR DE GIT' : explorerTab === 'docs' ? 'DOCUMENTACIÓN' : 'ARCHIVOS'}<span className="panel-header-actions">{explorerTab === 'git' && <><button className="tool-button" title="Actualizar" aria-label="Actualizar el explorador" disabled={!repo || busy} onClick={() => load()}><RefreshCw size={15}/></button><button className="tool-button" title="Contraer todas las secciones" aria-label="Contraer todas las secciones" disabled={!repo} onClick={() => setAllSections(false)}><ChevronsDownUp size={15}/></button><button className="tool-button" title="Expandir todas las secciones" aria-label="Expandir todas las secciones" disabled={!repo} onClick={() => setAllSections(true)}><ChevronsUpDown size={15}/></button></>}{explorerTab === 'files' && <button className="tool-button" title="Buscar archivos" aria-label="Buscar archivos" aria-pressed={fileSearchOpen} disabled={!repo} onClick={() => setFileSearchOpen(value => !value)}><Search size={15}/></button>}{explorerTab === 'docs' && <DocumentationFilter value={documentationFolders} onChange={setDocumentationFolders} disabled={!repo}/>} {explorerTab !== 'git' && <button className="tool-button" title="Actualizar archivos" aria-label="Actualizar archivos" disabled={!repo} onClick={() => setFilesRevision(value => value + 1)}><RefreshCw size={15}/></button>}<button className="tool-button" title="Abrir repositorio en el explorador de archivos" aria-label="Abrir repositorio en el explorador de archivos" disabled={!repo} onClick={() => { if (repo) window.gitGraph.openFolder(repo.root).catch(e => setError(e.message || String(e))) }}><FolderOpen size={16}/></button></span></div><div id="git-explorer" role="tabpanel" hidden={explorerTab !== 'git'}>{repo ? <Explorer repo={repo} filter={filter} selected={selected} busy={busy} tags={tags} remoteBranches={remoteBranches} branchDates={branchDates} open={{ branches: branchesOpen, remotes: remotesOpen, worktrees: worktreesOpen, stashes: stashesOpen, tags: tagsOpen }} onToggle={toggleSection} onFilter={setFilter} onCheckout={openRef} onSelectCommit={setSelected} onSelectWorktree={selectWorktree} onManage={setManage} onCopyTag={copyTag} onMenu={openManageMenu}/> : <p className="panel-empty">{loadingProject ? 'Cargando ramas y worktrees…' : 'Abre un repositorio para ver sus ramas y worktrees.'}</p>}</div><div id="file-explorer" role="tabpanel" hidden={explorerTab !== 'files'}>{repo ? <RepositoryFiles key={repo.root + ' : ' + filesRevision} root={repo.root} searchOpen={fileSearchOpen} onCloseSearch={() => setFileSearchOpen(false)} selectedPath={viewedFile && viewedFile.root === repo.root ? viewedFile.path : undefined} onSelectFile={path => setViewedFile({ root: repo.root, path })}/> : <p className="panel-empty">Abre un repositorio para ver sus archivos.</p>}</div><div id="documentation-explorer" role="tabpanel" hidden={explorerTab !== 'docs'}>{repo ? <DocumentationFiles includeFolders={documentationFolders} key={repo.root + ' : ' + filesRevision} root={repo.root} selectedPath={viewedFile && viewedFile.root === repo.root && viewedFile.documentation ? viewedFile.path : undefined} onSelect={path => setViewedFile({ root: repo.root, path, documentation: true })}/> : <p className="panel-empty">Abre un repositorio para ver su documentación.</p>}</div><div id="ai-explorer" role="tabpanel" hidden={explorerTab !== 'ai'}>{repo ? <AiFiles key={repo.root + ' : ' + filesRevision} root={repo.root} selectedPath={viewedFile && viewedFile.root === repo.root ? viewedFile.path : undefined} onSelect={path => setViewedFile({ root: repo.root, path })}/> : <p className="panel-empty">Abre un repositorio para ver sus archivos de IA y agentes.</p>}</div></aside>}
    {leftOpen && <PanelSeparator panel="branches" side={panelSide("branches")} order={panelPosition("branches") + (panelSide("branches") === "left" ? 1 : -1)} width={displayedLeft} maxWidth={maxLeft} onResize={value => { if (rightOpen && value > maxLeft + 24) { void changeSetting('rightOpen', false); setLeftWidth(clamp(value, PANEL_MIN, workspaceWidth - GRAPH_MIN - HANDLE_SIZE)) } else setLeftWidth(clamp(value, PANEL_MIN, maxLeft)) }}/>}
    <section className="graph-area" style={{ order: panelPosition('graph'), ...columnStyle }} aria-busy={Boolean(loadingProject)}>
    {viewedFile && repo?.root === viewedFile.root && !loadingProject ? <FileViewer key={viewedFile.root + ":" + viewedFile.path} root={viewedFile.root} path={viewedFile.path} documentation={viewedFile.documentation} onAsk={aiSettings.showAI && aiSettings.showAIAgent ? () => { setDocumentationQuestion(viewedFile.path); setAgentOpen(true) } : undefined} onClose={() => setViewedFile(null)}/> : <>
    <header className="toolbar">
      <span className="repository" title={repo?.root}>{repo ? repo.root.split(/[\\/]/).pop() : 'Git Glam'}</span>
      <div className="branch-picker"><label htmlFor="branches">Ramas:</label><select id="branches" value={filter} disabled={!repo} onChange={e => setFilter(e.target.value)}><option value="all">Todas las ramas</option>{refs.map(ref => <option key={ref} value={ref}>{ref}</option>)}</select></div>
      <label className="remote-toggle"><input type="checkbox" checked={showRemote} disabled={!repo || busy} onChange={e => changeSetting('showRemote', e.target.checked)}/><span>Mostrar ramas remotas</span></label>
      <div className="toolbar-actions"><button className="run-project-command" title={projects.find(project => project.path === activeProject)?.command?.trim() ? 'Ejecutar el comando del proyecto' : 'Configurar el comando del proyecto'} aria-label="Ejecutar comando del proyecto" disabled={!repo || busy || launchingCommand} onClick={runProjectCommand}>{launchingCommand ? <LoaderCircle className="spin" size={16}/> : <SquareTerminal size={16}/>}</button>{searchOpen && <input className="search-input" aria-label="Buscar commits" placeholder="Buscar commits..." value={query} onChange={e => setQuery(e.target.value)} autoFocus/>}<button className="tool-button small" title="Buscar (/ )" aria-label="Buscar" onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setQuery('') }}><Search size={16}/></button><button className={'tool-button small '+(busy?'spin':'')} title="Actualizar (F5)" aria-label="Actualizar" disabled={!repo || busy} onClick={() => load()}><RefreshCw size={16}/></button></div>
    </header>
    {loadingProject ? <div className="project-loading" role="status" aria-live="polite"><span className="project-loading-icon"><LoaderCircle className="spin" size={22}/></span><strong>Cargando proyecto…</strong><span>{loadingProject}</span></div> : !repo ? <div className="empty"><GitMerge size={38}/><h1>{activeProject ? 'No se pudo abrir el proyecto' : 'Git Glam'}</h1><p>{activeProject ? 'Comprueba que el repositorio esté disponible.' : 'Abre un repositorio para explorar su historial.'}</p>{activeProject ? <button className="open-cta" onClick={() => openProject(activeProject)}>Reintentar</button> : <button className="open-cta" onClick={() => load(true)}><FolderOpen size={16}/> Abrir repositorio</button>}</div> : <>
      <div className="table-head">{[['Grafo', 'graph'], ['Descripción', 'date'], ['Fecha', 'date'], ['Autor', 'author'], ['Commit', 'hash']].map(([label, key], index) => <span key={label}>{label}<ColumnResize label={label} width={key === 'graph' ? graphWidth : Number(widths[key]) || ({ date: 125, author: 100, hash: 75 }[key])} direction={index === 1 ? -1 : 1} onResize={value => setColumnWidths(old => ({ ...old, [key]: clamp(value, 50, 600) }))} onReset={key === 'graph' ? () => setColumnWidths(old => ({ ...old, graph: 0 })) : undefined}/></span>)}</div>
      <CommitList rowHeight={layoutDensity === 'compact' ? 22 : 28} rows={rows} hasMore={repo.hasMore} loadingMore={loadingMore} onLoadMore={loadMore} selectedHash={selected?.hash} contextHash={commitMenu?.commit.hash} visibleHashes={visibleHashes} query={query} showRemote={showRemote} palette={branchPalette.preset === 'custom' ? branchPalette.custom : GRAPH_PALETTES[branchPalette.preset] || GRAPH_PALETTES.classic} remotes={repo.remotes} onSelect={setSelected} onContext={openCommitMenu} onRefContext={openRefMenu} onRefOpen={openRef}/>
      {selectedChange && <WorkingDiff root={repo.root} change={selectedChange} version={repo} busy={busy} onHunk={request => changeAction(root => window.gitGraph.applyHunk(root, request))} onDiscardHunk={hunk => setManage({ kind: 'discard-hunk', hunk })} onClose={() => setSelectedChange(null)}/>}
      {selected && !selectedChange && <CommitDetails commit={selected} root={repo.root} diff={diff} formatDate={date} onFileContext={(path, rev, x, y) => setFileMenu({ path, rev, x, y })} onSelectHash={hash => { const target = repo.commits.find(commit => commit.hash === hash); if (target) setSelected(target) }} onClose={() => setSelected(null)}/>}
    </>}
    </>}
    </section>
    {rightOpen && <PanelSeparator panel="changes" side={panelSide("changes")} order={panelPosition("changes") + (panelSide("changes") === "left" ? 1 : -1)} width={displayedRight} maxWidth={maxRight} onResize={value => { if (leftOpen && value > maxRight + 24) { void changeSetting('leftOpen', false); setRightWidth(clamp(value, PANEL_MIN, workspaceWidth - GRAPH_MIN - HANDLE_SIZE)) } else setRightWidth(clamp(value, PANEL_MIN, maxRight)) }}/>}
    {rightOpen && <aside id="changes-panel" className="right-panel" style={{ width: displayedRight, order: panelPosition('changes') }}><div className="panel-header">CONTROL DE CÓDIGO FUENTE<button className={'tool-button '+(busy?'spin':'')} title="Actualizar (F5)" aria-label="Actualizar cambios" disabled={!repo || busy} onClick={() => load()}><RefreshCw size={16}/></button></div>{repo ? <><SyncBar repo={repo} busy={busy} syncing={syncing} onSync={syncAction} onPickBranch={() => setPickerOpen(true)}/><Conflicts key={repo.root} root={repo.root} version={repo} onRefresh={() => load()}/><CommitBox showAICommit={aiSettings.showAI && aiSettings.showAICommit} key={repo.root} dir={repo.root} sync={repo.sync?.[repo.branch]} syncing={syncing === 'sync'} onSync={() => syncAction('sync')} changes={repo.changes} publishedTo={publishedTo} disabled={busy} onError={setError} onCommitted={async (_amended, pushed) => { await load(); setNotice(pushed ? 'Commit creado y enviado' : 'Commit creado') }}/><ChangesList onReview={aiSettings.showAI && aiSettings.showAIReview ? () => { setFileReview({ all: true }); setAgentOpen(true) } : undefined} onContext={(change, staged, x, y) => setFileMenu({ ...change, staged, x, y, working: true })} changes={repo.changes} selected={selectedChange} busy={busy} onPick={change => { setViewedFile(null); setSelectedChange(change); setSelected(null) }} onStage={paths => changeAction(root => window.gitGraph.stage(root, paths))} onUnstage={paths => changeAction(root => window.gitGraph.unstage(root, paths))} onDiscard={paths => setManage({ kind: 'discard', paths })}/></> : <p className="panel-empty">{loadingProject ? 'Cargando cambios…' : 'Abre un repositorio para ver sus cambios.'}</p>}</aside>}
    </div>
    <footer><span title={repo?.root || loadingProject}>{repo?.root || loadingProject || 'Git Glam'}</span>{repo && <span>{repo.branch} · {repo.changes.length} cambios pendientes · {repo.commits.length}{repo.hasMore ? '+' : ''} commits cargados</span>}</footer>
    {pickerOpen && repo && <BranchPicker dir={repo.root} onClose={() => setPickerOpen(false)} onManage={(branch, event) => { setPickerOpen(false); openManageMenu(branchItems(branch, { current: repo.branch, tracking: Boolean(repo.sync?.[branch.name]) }, setManage), event) }} onDone={() => { setPickerOpen(false); load() }}/>}
    {issuesOpen && repo && <ForgeDialog root={repo.root} onClose={() => setIssuesOpen(false)}/>}
    {improveOpen && repo && <ImprovementsDialog key={repo.root} root={repo.root} onClose={() => setImproveOpen(false)}/>}
    {agentOpen && repo && <AgentDialog key={repo.root} root={repo.root} fileReview={fileReview} documentationPath={documentationQuestion} onClose={() => { setAgentOpen(false); setFileReview(null); setDocumentationQuestion(undefined) }}/>}
    {manageMenu && <ContextMenu x={manageMenu.x} y={manageMenu.y} items={manageMenu.items} onClose={closeManageMenu}/>}
    {manage && repo && <ManageDialog request={manage} root={repo.root} onClose={() => setManage(null)} onDone={async notice => { setManage(null); await load(); setNotice(notice) }}/>}
    {commitMenu && !busy && <CommitMenu menu={commitMenu} onClose={closeCommitMenu} onAction={chooseCommitAction}/>}
    {fileMenu?.working && repo && <ContextMenu x={fileMenu.x} y={fileMenu.y} label="Acciones del archivo" onClose={closeFileMenu} items={[
      ...(aiSettings.showAI && aiSettings.showAIReview ? [{ label: 'Analizar archivo con IA', run: () => { setFileReview({ path: fileMenu.path, staged: fileMenu.staged }); setAgentOpen(true) } }] : []),
      { label: 'Abrir cambios', run: () => { setSelectedChange({ path: fileMenu.path, staged: fileMenu.staged, untracked: fileMenu.status === '??' }); setSelected(null) } },
      { label: 'Abrir archivo', run: () => window.gitGraph.fileAction(repo.root, fileMenu.path, 'open').catch(e => setError(e.message || String(e))) },
      { label: 'Abrir archivo (HEAD)', disabled: fileMenu.status === '??' || !repo.head || fileMenu.status[0] === 'A', run: () => window.gitGraph.fileAction(repo.root, fileMenu.path, 'head').catch(e => setError(e.message || String(e))) },
      null,
      ...(fileMenu.staged ? [{ label: 'Cancelar almacenamiento provisional de los cambios', disabled: busy, run: () => changeAction(root => window.gitGraph.unstage(root, [fileMenu.path])) }] : [
        { label: 'Descartar cambios', disabled: busy, run: () => setManage({ kind: 'discard', paths: [fileMenu.path] }) },
        { label: 'Almacenar cambios provisionalmente', disabled: busy, run: () => changeAction(root => window.gitGraph.stage(root, [fileMenu.path])) },
        { label: 'Añadir a .gitignore', disabled: busy || fileMenu.status !== '??', run: () => changeAction(root => window.gitGraph.fileAction(root, fileMenu.path, 'ignore')) },
      ]), null,
      { label: 'Mostrar en el Explorador de archivos', run: () => window.gitGraph.fileAction(repo.root, fileMenu.path, 'reveal').catch(e => setError(e.message || String(e))) },
      { label: 'Mostrar en la vista Explorador', disabled: true, run: () => {} }, null,
      { label: 'Historial del archivo', disabled: fileMenu.status === '??', run: () => setFileHistory({ path: fileMenu.path }) },
    ]}/>}
    {fileMenu && !fileMenu.working && <FileMenu menu={fileMenu} onClose={closeFileMenu} onHistory={(path, rev) => { setFileMenu(null); setFileHistory({ path, rev }) }}/>}
    {fileHistory && repo && <FileHistoryDialog root={repo.root} path={fileHistory.path} rev={fileHistory.rev} formatDate={date} onClose={() => setFileHistory(null)}/>}
    {action && <CommitActionDialog key={action.type + action.commit.hash} action={action} busy={busy} error={actionError} onCancel={() => setAction(null)} onRun={executeCommitAction}/>}
    {checkoutVisible && <div className="checkout-progress" role="status" aria-live="polite"><div><RefreshCw className="spin" size={22} aria-hidden="true"/><span>Cambiando de rama…</span></div><button type="button" onClick={() => setCheckoutVisible(false)}>Cerrar</button></div>}
    {(notice || error) && <div className="notifications">
      {notice && <div className="notification notification-success" role="status"><CircleCheck className="notification-icon" size={20} aria-hidden="true"/><span className="notification-message">{notice}</span><button type="button" aria-label="Cerrar aviso de éxito" onClick={() => setNotice('')}><X size={16} aria-hidden="true"/></button></div>}
      {error && <div className="notification notification-error" role="alert"><CircleAlert className="notification-icon" size={20} aria-hidden="true"/><span className="notification-message">{error}</span><button type="button" aria-label="Cerrar aviso de error" onClick={() => setError('')}><X size={16} aria-hidden="true"/></button></div>}
    </div>}
  </main>
}
void migrateElectronUi().finally(() => createRoot(document.getElementById('root')!).render(<App />))



