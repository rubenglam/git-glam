import { moveProjectTab } from './project-order.ts'
import { errorMessage } from './repo-flow.ts'

export interface ProjectLike { path: string, folderId?: string | null }

export const isTabHidden = (project: ProjectLike, hiddenTabs: string[], hiddenFolders: string[], groupTabs: boolean) =>
  hiddenTabs.includes(project.path) || Boolean(groupTabs && project.folderId && hiddenFolders.includes(project.folderId))

// The tab strip only shows visible projects. After the user reorders those, slot them back into the
// full list while hidden projects keep their positions.
export function mergeVisibleOrder<T extends ProjectLike>(projects: T[], nextVisible: T[], isHidden: (project: T) => boolean): T[] {
  const queue = [...nextVisible]
  return projects.map(project => isHidden(project) ? project : queue.shift()!)
}

// Opening a hidden project (or one inside a hidden folder) reveals its tab again.
export function revealProject(project: ProjectLike, hiddenTabs: string[], hiddenFolders: string[]) {
  return {
    hiddenTabs: hiddenTabs.includes(project.path) ? hiddenTabs.filter(path => path !== project.path) : hiddenTabs,
    hiddenFolders: project.folderId && hiddenFolders.includes(project.folderId) ? hiddenFolders.filter(id => id !== project.folderId) : hiddenFolders,
  }
}

export interface ProjectState { projects: ProjectLike[], folders?: { id: string }[] }

export interface MoveApi {
  move(path: string, folderId: string | null): Promise<ProjectState>
  reorder(paths: string[]): Promise<ProjectState>
}

// Dragging a tab into another folder: move it, then (optionally) place it next to a target tab.
export async function moveTabFlow(api: MoveApi, path: string, folderId: string | null, targetPath: string | null, side: 'before' | 'after'): Promise<ProjectState> {
  let state = await api.move(path, folderId)
  if (targetPath) state = await api.reorder(moveProjectTab(state.projects, path, targetPath, side).map(project => project.path))
  return state
}

export interface OpenProjectApi {
  open(path: string, showRemote: boolean): Promise<{ repo: any, state: { projects: any[], activeProject: string } }>
}

export type OpenOutcome = { result: { repo: any, state: { projects: any[], activeProject: string } } } | { error: string } | null

// Opens a project that is not cached. Returns null when a newer request superseded this one,
// so neither a late success nor a late failure touches the UI.
export async function openUncachedProject(api: OpenProjectApi, path: string, showRemote: boolean, isCurrent: () => boolean): Promise<OpenOutcome> {
  try {
    const result = await api.open(path, showRemote)
    return isCurrent() ? { result } : null
  } catch (error) {
    return isCurrent() ? { error: `No se pudo abrir el proyecto «${path}»: ${errorMessage(error)}` } : null
  }
}
