import { useEffect, useMemo, useState } from 'react'
import { useStoredState } from './use-stored-state.ts'
import { errorMessage } from '../lib/repo-flow.ts'
import { isTabHidden, mergeVisibleOrder, moveTabFlow, revealProject } from '../lib/project-flow.ts'

interface Options {
  setBusy: (busy: boolean) => void
  setError: (message: string) => void
  groupTabs: boolean
  // Changes whenever the open repository is reloaded, so tab statuses (dirty/ahead/behind) refresh with it.
  repoVersion: unknown
}

// Saved projects, folders, tab visibility/order and the per-project status badges.
// Operations that also touch the open repository (open, remove, worktree switch) stay in App.
export function useProjects({ setBusy, setError, groupTabs, repoVersion }: Options) {
  const [projects, setProjects] = useState<any[]>([]), [folders, setFolders] = useState<any[]>([]), [activeProject, setActiveProject] = useState<any>(null)
  const [defaultProject, setDefaultProject] = useState<any>(null), [showProjects, setShowProjects] = useState(true), [statuses, setStatuses] = useState({})
  const [hiddenTabs, setHiddenTabs] = useStoredState('gitgraph.hiddenTabs', [])
  const [hiddenFolders, setHiddenFolders] = useStoredState('gitgraph.hiddenFolders', [])

  const isHidden = (project: any) => isTabHidden(project, hiddenTabs, hiddenFolders, groupTabs)
  const visibleProjects = useMemo(() => projects.filter(project => !isHidden(project)), [projects, hiddenTabs, hiddenFolders, groupTabs])

  // Opening a hidden project reveals its tab (and folder) again.
  useEffect(() => {
    const active = !showProjects && projects.find(project => project.path === activeProject)
    if (!active) return
    const revealed = revealProject(active, hiddenTabs, hiddenFolders)
    if (revealed.hiddenTabs !== hiddenTabs) setHiddenTabs(revealed.hiddenTabs)
    if (revealed.hiddenFolders !== hiddenFolders) setHiddenFolders(revealed.hiddenFolders)
  }, [activeProject, showProjects, projects, hiddenTabs, hiddenFolders])

  const projectPaths = projects.map(project => project.path).join('\n')
  useEffect(() => {
    if (!projectPaths) { setStatuses({}); return }
    let cancelled = false
    const refresh = () => { if (document.hidden) return; window.gitGraph.projects.status(projectPaths.split('\n')).then(result => { if (!cancelled) setStatuses(result) }).catch(() => {}) }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [projectPaths, repoVersion])

  function hideTab(path: string) {
    setHiddenTabs(old => old.includes(path) ? old : [...old, path])
    if (activeProject === path && !showProjects) setShowProjects(true)
  }
  function hideFolder(folderId: string) {
    setHiddenFolders(old => old.includes(folderId) ? old : [...old, folderId])
    if (!showProjects && projects.find(project => project.path === activeProject)?.folderId === folderId) setShowProjects(true)
  }

  async function setDefault(path: string | null) {
    setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.setDefault(path); setDefaultProject(state.defaultProject) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const toggleDefault = (path: string) => setDefault(defaultProject === path ? null : path)

  async function folderAction(type: 'create' | 'rename' | 'delete', id: string, name: string) {
    setBusy(true)
    try {
      const api = window.gitGraph.projects
      const state = type === 'create' ? await api.createFolder(name) : type === 'rename' ? await api.renameFolder(id, name) : await api.deleteFolder(id)
      setFolders(state.folders); setProjects(state.projects)
    } finally { setBusy(false) }
  }
  async function moveProject(path: string, folderId: string | null) {
    setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.move(path, folderId); setFolders(state.folders); setProjects(state.projects) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function moveTab(path: string, folderId: string | null, targetPath: string | null, side: 'before' | 'after') {
    setBusy(true); setError('')
    try {
      const state: any = await moveTabFlow(window.gitGraph.projects, path, folderId, targetPath, side)
      setFolders(state.folders ?? folders); setProjects(state.projects)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function saveAppearance(path: string, patch: object) {
    const current = projects.find(project => project.path === path) || {}
    setBusy(true)
    try { const state = await window.gitGraph.projects.setAppearance(path, { name: current.name, icon: current.icon, color: current.color, colorTargets: current.colorTargets, ...patch }); setProjects(state.projects) }
    finally { setBusy(false) }
  }
  async function saveCommand(path: string, command: string) {
    setBusy(true)
    try { const state = await window.gitGraph.projects.setCommand(path, command); setProjects(state.projects) }
    finally { setBusy(false) }
  }

  // Optimistic reorder: shown immediately, rolled back if the host rejects it.
  async function reorderProjects(next: any[], focusPath?: string) {
    if (next === projects || next.every((project, index) => project.path === projects[index]?.path)) return
    const previous = projects
    setProjects(next); setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.reorder(next.map(project => project.path)); setProjects(state.projects) }
    catch (e) { setProjects(previous); setError(errorMessage(e)) }
    finally {
      setBusy(false)
      if (focusPath) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('.project-tabs-list button')].find(button => button.dataset.projectPath === focusPath)?.focus())
    }
  }
  const reorderTabs = (nextVisible: any[], focusPath?: string) => reorderProjects(mergeVisibleOrder(projects, nextVisible, isHidden), focusPath)
  async function reorderFolders(next: any[]) {
    if (next.every((folder, index) => folder.id === folders[index]?.id)) return
    const previous = folders
    setFolders(next); setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.reorderFolders(next.map(folder => folder.id)); setFolders(state.folders) }
    catch (e) { setFolders(previous); setError(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return {
    projects, setProjects, folders, setFolders, activeProject, setActiveProject, defaultProject, setDefaultProject, showProjects, setShowProjects, statuses, visibleProjects,
    hideTab, hideFolder, setDefault, toggleDefault, folderAction, moveProject, moveTab, saveAppearance, saveCommand, reorderTabs, reorderFolders,
  }
}
