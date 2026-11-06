import type { ReactNode } from 'react'

export interface Change {
  x: string
  y: string
  path: string
}

interface CommitBase {
  stash?: string
  stashParents?: string[]
  comparisons?: CommitComparison[]
  diffNotice?: string
  hash: string
  parents: string[]
  refs: string[]
  subject: string
  author: string
  date: Date | null
  message?: string
  authorEmail?: string
}

export interface CommitFile {
  path: string
  oldPath?: string
  status: string
  patch: string
  binary: boolean
  notice?: string
}

export interface CommitComparison {
  label: string
  base: string | null
  target: string
  files: CommitFile[]
  notice?: string
}

export interface GitCommit extends CommitBase {
  wip?: false
}

export interface WorkingCommit extends CommitBase {
  wip: true
  changes: Change[]
}

export type Commit = GitCommit | WorkingCommit
export type PanelCommit = (Omit<GitCommit, 'date'> | Omit<WorkingCommit, 'date'>) & { dateLabel: string }

export interface GraphRow<T = Commit> {
  commit: T
  col: number
  hasIncoming: boolean
  before: (string | null)[]
  after: (string | null)[]
  joins: number[]
  forks: number[]
}

export type PanelRow = GraphRow<PanelCommit>

export interface LocalRef {
  name: string
  active: boolean
  remotes: string[]
}

export interface GroupedRefs {
  heads: LocalRef[]
  remotes: string[]
  tags: string[]
}

export interface PanelRefs {
  heads: (LocalRef & { color: string })[]
  remotes: { name: string; color: string }[]
  tags: { name: string; color: string }[]
}

export type UpstreamStatus =
  | { state: 'tracked'; name: string; ahead: number; behind: number }
  | { state: 'missing' | 'unavailable'; name: string }
  | { state: 'none' | 'detached' | 'unborn' }

export interface PanelData {
  repo: string
  repoPath?: string
  actionModule?: string
  branch: string
  head: string
  upstream?: UpstreamStatus
  rows: PanelRow[]
  refsByCommit: Record<string, PanelRefs>
  now: string
  error: string
  loading?: boolean
  unborn?: boolean
  history?: HistoryInfo
}

export interface HistoryRequest {
  session: string
  limit: number
  target?: string
}

export interface HistoryInfo extends HistoryRequest {
  count: number
  incomplete: boolean
  capped: boolean
  focus?: string
  notice?: string
}

export interface RenderOptions {
  repo: string
  branch: string
  head: string
  upstream?: UpstreamStatus
  rows: GraphRow[]
  remotes?: string[]
  now?: Date | null
  error?: string
  loading?: boolean
  history?: HistoryInfo
  unborn?: boolean
}

/** Bridge exposed by `electron/preload.ts` through `contextBridge`; IPC results are untyped JSON. */
export interface GitGraphApi {
  isPackaged(): Promise<boolean>
  onRestored(callback: () => void): () => void
  fileAction(path: string, file: string, action: string): Promise<void>
  openFolder(path: string): Promise<void>
  open(): Promise<any>
  load(path: string, showRemote?: boolean, limit?: number): Promise<any>
  history(path: string, showRemote?: boolean, limit?: number): Promise<any>
  diff(path: string, hash: string): Promise<string>
  commitFiles(path: string, hash: string): Promise<any>
  fileHistory(path: string, file: string, rev?: string): Promise<any>
  fileBlame(path: string, file: string, rev?: string): Promise<any>
  commitAction(path: string, request: any): Promise<any>
  branches(path: string): Promise<any>
  switchBranch(path: string, ref: string): Promise<any>
  createBranch(path: string, name: string): Promise<any>
  fetch(path: string): Promise<any>
  pull(path: string): Promise<any>
  push(path: string): Promise<any>
  stage(path: string, files: string[]): Promise<any>
  unstage(path: string, files: string[]): Promise<any>
  stagedDiff(path: string): Promise<string>
  workingDiff(path: string, request: any): Promise<any>
  applyHunk(path: string, request: any): Promise<any>
  lastMessage(path: string): Promise<string>
  commit(path: string, message: string, options?: { amend?: boolean }): Promise<any>
  commitAndPush(path: string, message: string, options?: { amend?: boolean }): Promise<any>
  discard(path: string, files: string[]): Promise<any>
  discardHunk(path: string, request: any): Promise<any>
  renameBranch(path: string, name: string, newName: string): Promise<any>
  deleteBranch(path: string, name: string, force?: boolean): Promise<any>
  deleteRemoteBranch(path: string, ref: string): Promise<any>
  setUpstream(path: string, name: string, ref: string | null): Promise<any>
  branchOp(path: string, type: string, ref: string): Promise<any>
  checkoutRemote(path: string, ref: string, name?: string): Promise<any>
  stashPush(path: string, options?: { message?: string; includeUntracked?: boolean; keepIndex?: boolean }): Promise<any>
  stashApply(path: string, hash: string): Promise<any>
  stashPop(path: string, hash: string): Promise<any>
  stashDrop(path: string, hash: string): Promise<any>
  tags(path: string): Promise<any>
  createTag(path: string, request: { name: string; hash?: string; message?: string }): Promise<any>
  deleteTag(path: string, name: string, options?: { remote?: boolean; remoteName?: string }): Promise<any>
  pushTag(path: string, name: string, remote?: string): Promise<any>
  forgeInfo(path: string): Promise<any>
  forgeFacets(path: string, kind: string): Promise<any>
  forgeList(path: string, kind: string, options?: { state?: string; filters?: any }): Promise<any>
  forgeComment(path: string, kind: string, id: number, body: string): Promise<any>
  forgeDetail(path: string, kind: string, id: number): Promise<any>
  hasIssueToken(path: string): Promise<boolean>
  setIssueToken(path: string, token: string): Promise<any>
  openIssue(url: string): Promise<any>
  generateCommitMessage(path: string, id: string): Promise<string>
  cancelCommitMessage(id: string): Promise<void>
  improvements: {
    load(path: string): Promise<any[]>
    save(path: string, data: any[]): Promise<void>
  }
  agent: {
    send(path: string, request: any): Promise<string>
    cancel(id: string): Promise<void>
    load(path: string): Promise<any>
    save(path: string, data: any): Promise<any>
    onEvent(callback: (id: string, payload: any) => void): () => void
  }
  settings: { read(): Promise<any>; set(key: string, value: any): Promise<any> }
  projects: {
    list(): Promise<any>
    status(paths: string[]): Promise<any>
    setDefault(path: string | null): Promise<any>
    add(): Promise<any>
    open(path: string, showRemote?: boolean): Promise<any>
    select(path: string): Promise<any>
    worktree(project: string, path: string, showRemote?: boolean): Promise<any>
    remove(path: string): Promise<any>
    createFolder(name: string): Promise<any>
    renameFolder(id: string, name: string): Promise<any>
    reorderFolders(ids: string[]): Promise<any>
    deleteFolder(id: string): Promise<any>
    move(path: string, folderId: string | null): Promise<any>
    reorder(paths: string[]): Promise<any>
    setCommand(path: string, command: string): Promise<any>
    setAppearance(path: string, appearance: any): Promise<any>
    runCommand(path: string, worktree: string): Promise<any>
  }
}

declare global {
  interface Window { gitGraph: GitGraphApi }
}

export type DiffLine =
  | { type: 'hunk'; text: string; header: string; index: number; oldNo?: undefined; newNo?: undefined }
  | { type: 'add'; text: string; newNo: number; oldNo?: undefined }
  | { type: 'del'; text: string; oldNo: number; newNo?: undefined }
  | { type: 'note'; text: string; oldNo?: undefined; newNo?: undefined }
  | { type: 'ctx'; text: string; oldNo: number; newNo: number }

export interface ParsedDiffFile {
  path: string
  notes: string[]
  lines: DiffLine[]
  hunks: number
  added: number
  deleted: number
  pathFallback?: string
}

export interface HunkAction {
  label: string
  title?: string
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  run: (file: ParsedDiffFile, line: Extract<DiffLine, { type: 'hunk' }>) => void
}

export interface DiffState {
  text: string
  loading?: boolean
  error?: string
}

export interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
}

export interface FormField { key: string; label: string; initial?: string | boolean; placeholder?: string; multiline?: boolean }
export interface FormChoice { key: string; label: string; options: [string, string][]; initial?: string }

/** One entry of `git status --porcelain`: two status letters (index, work tree) and the path. */
export interface FileChange {
  status: string
  path: string
}
