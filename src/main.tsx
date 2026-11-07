import { Conflicts } from './conflicts'
import { installModalFocus } from './modal-focus.ts'
import { UpdateNotice, UpdateToast, startUpdateChecks } from './app-updater.tsx'
import { migrateElectronUi } from './tauri-bridge.ts'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Archive, BookOpen, Bot, BotMessageSquare, Lightbulb, CircleAlert, CircleCheck, CircleDot, ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, File, Folder, FolderGit2, FolderOpen, FolderPlus, Github, GitBranch, GitMerge, Cloud, CloudDownload, Ellipsis, LoaderCircle, PanelLeft, PanelRight, Pencil, Plus, RefreshCw, Search, Settings, SquareTerminal, Star, Tag, Trash2, X } from 'lucide-react'
import { layout, orderHistory } from './graph-layout.ts'
import type { DiffState, GraphRow } from './types.ts'
import { graphSegments } from './graph-segments.ts'
import { moveProjectTab } from './project-order.ts'
import { applyChange, updatedSelection } from './repo-flow.ts'

const isDevelopmentBuild = import.meta.env.DEV
const appIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
if (appIcon) appIcon.href = isDevelopmentBuild ? '/logo-dev.svg' : '/logo.svg'
import { CommitActionDialog, CommitMenu } from './commit-actions.tsx'
import { CommitDetails } from './commit-details.tsx'
import { FileHistoryDialog, FileMenu } from './file-history.tsx'
import { SettingsPage } from './settings.tsx'
import { BranchPicker, CommitBox } from './branch-picker.tsx'
import { ContextMenu } from './dialogs.tsx'
import { ProjectIcon, PROJECT_COLORS, projectName, colorClasses } from './project-icons.tsx'
import { ForgeDialog, prefetchForge } from './issues.tsx'
import { AgentDialog } from './agent-chat.tsx'
import { ImprovementsDialog } from './improvements.tsx'
import { ManageDialog, branchItems, graphBranchItems, stashItems, tagItems } from './manage.tsx'
import { ChangesList, isStaged, isUnstaged } from './changes-list.tsx'
import { WorkingDiff } from './working-diff.tsx'
import { Explorer } from './explorer.tsx'
import { DocumentationFilter } from './documentation-filter.tsx'
import { DocumentationFiles } from './documentation-files.tsx'
import { AiFiles } from './ai-files.tsx'
import { RepositoryFiles } from './repository-files.tsx'
import { FileViewer } from './file-viewer.tsx'
import lightStyles from './style.css?inline'
import darkStyles from './style-dark.css?inline'

installModalFocus()

const themeStyles = document.createElement('style')
themeStyles.textContent = darkStyles
document.head.appendChild(themeStyles)

const GRAPH_PALETTES = {
  classic: ['#009ce9', '#e30094', '#00d625', '#e69a00', '#aa00e8', '#ee4c4c', '#00cabc', '#9be000', '#4f5bff', '#b5651d'],
  ocean: ['#1d6fdc', '#00c2d1', '#7b61ff', '#12a38a', '#ff7f6b', '#f2c14e', '#a3d9ff', '#c04fb5', '#5ee6a8', '#6c7a89'],
  forest: ['#2e9e4f', '#c5d93a', '#8b5a2b', '#e8a317', '#c8432b', '#2aa6a0', '#8e6bbf', '#e68fac', '#9bd0a0', '#d2b48c'],
  sunset: ['#ff4d6d', '#ff8a00', '#ffd23f', '#9b5de5', '#f15bb5', '#00bbf9', '#2ec4b6', '#c1121f', '#7c83fd', '#ffa69e'],
  pastel: ['#7aa2f7', '#f7768e', '#9ece6a', '#e0af68', '#bb9af7', '#73daca', '#ff9e64', '#7dcfff', '#f4b8e4', '#d4a373'],
}
const color = (i, colors = GRAPH_PALETTES.classic) => colors[i % colors.length]
const date = value => value ? new Date(value).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : ''
const HISTORY_PAGE = 500
const PANEL_MIN = 160
const GRAPH_MIN = 360
const HANDLE_SIZE = 6
const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

function PanelSeparator({ side, panel, order, width, maxWidth, onResize }) {
  const drag = useRef<any>(null)
  const direction = side === 'left' ? 1 : -1
  const finishDrag = event => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="panel-separator" style={{ order }} role="separator" tabIndex={0} aria-controls={panel === 'branches' ? 'branches-panel' : 'changes-panel'} aria-label={panel === 'branches' ? 'Ajustar ancho del panel de ramas' : 'Ajustar ancho del panel de cambios'} aria-orientation="vertical" aria-valuemin={PANEL_MIN} aria-valuemax={maxWidth} aria-valuenow={width} onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + direction * (event.clientX - drag.current.x))
  }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null }} onKeyDown={event => {
    let value
    if (event.key === 'ArrowLeft') value = width - 10 * direction
    else if (event.key === 'ArrowRight') value = width + 10 * direction
    else if (event.key === 'Home') value = PANEL_MIN
    else if (event.key === 'End') value = maxWidth
    else return
    event.preventDefault()
    onResize(value)
  }}/>
}

function ColumnResize({ label, width, direction, onResize, onReset }) {
  const drag = useRef<{ x: number, width: number, pointerId: number } | null>(null)
  return <div className="column-resize" role="separator" tabIndex={0} aria-label={`Redimensionar ${label}`} aria-orientation="vertical" aria-valuemin={50} aria-valuemax={600} aria-valuenow={Math.round(width)} title="Arrastra para redimensionar" onDoubleClick={onReset} onPointerDown={event => { event.preventDefault(); drag.current = { x: event.clientX, width, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + direction * (event.clientX - drag.current.x)) }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); onResize(width + (event.key === 'ArrowRight' ? 10 : -10) * direction) }}/>
}

function Graph({ row, head, rowHeight, palette }) {
  const x = i => 17 + i * 18
  return <svg className="graph" width="100%" height={rowHeight} aria-hidden="true">
    {graphSegments(row, rowHeight).map((segment, index) => <path key={index} d={segment.d} stroke={color(segment.lane, palette)} />)}
    {head && <circle className="head-halo" cx={x(row.col)} cy={rowHeight / 2} r="9" fill="none" stroke={color(row.col, palette)} strokeWidth="2" />}
    <circle cx={x(row.col)} cy={rowHeight / 2} r={head ? 5 : 3.5} fill={head ? 'var(--graph-background)' : color(row.col, palette)} stroke={color(row.col, palette)} strokeWidth="2" />
  </svg>
}

function RefLabel({ name, lane, synced, onContext, onOpen, palette }) {
  const tag = name.startsWith('tag: ')
  const label = name.replace(/^HEAD -> /, '').replace(/^tag: /, '')
  return <span className="ref" onClick={tag || !onOpen ? undefined : event => { event.stopPropagation(); if (event.detail >= 2) { event.preventDefault(); onOpen(name.replace(/^HEAD -> /, '')) } }} onContextMenu={!onContext ? undefined : event => { event.preventDefault(); event.stopPropagation(); onContext(name.replace(/^HEAD -> /, ''), event) }}><span className="ref-icon" style={{ background: color(lane, palette) }}>{tag ? <Tag size={11}/> : <GitBranch size={11}/>}</span><span className="ref-name">{label}</span>{synced && <span className="ref-remote" title={`También en ${synced}`}><Cloud size={11}/><span className="ref-remote-name">{synced.split('/')[0]}</span></span>}</span>
}

interface CommitRowProps {
  row: GraphRow<any>
  rowHeight: number
  selected: boolean
  contextActive: boolean
  matches: boolean
  showRemote: boolean
  palette: string[]
  remotes: string[]
  onSelect: (commit: any) => void
  onContext: (commit: any, x: number, y: number, origin?: any) => void
  onRefContext: (name: string, event: React.MouseEvent) => void
  onRefOpen: (name: string) => void
}

interface CommitListProps extends Omit<CommitRowProps, 'row' | 'selected' | 'contextActive' | 'matches'> {
  rows: GraphRow<any>[]
  hasMore: boolean
  loadingMore: boolean
  selectedHash?: string
  contextHash?: string
  visibleHashes: Set<string> | null
  query: string
  onLoadMore: () => void
}

const CommitRow = React.memo(function CommitRow({ row, rowHeight, selected, contextActive, matches, showRemote, palette, remotes, onSelect, onContext, onRefContext, onRefOpen }: CommitRowProps) {
  const commit = row.commit, isHead = commit.refs.some(r => r.startsWith('HEAD'))
  const isRemote = name => remotes.some(remote => name.replace(/^HEAD -> /, '').startsWith(remote + '/'))
  const names = new Set(commit.refs.map(r => r.replace(/^HEAD -> /, '')))
  const syncedRemote = ref => { const name = ref.replace(/^HEAD -> /, ''); return isRemote(name) || ref.startsWith('tag: ') ? undefined : remotes.map(remote => remote + '/' + name).find(full => names.has(full)) }
  const merged = new Set(commit.refs.map(syncedRemote).filter(Boolean))
  const visibleRefs = commit.refs.filter(ref => !merged.has(ref) && (showRemote || !isRemote(ref))).map(ref => ({ ref, synced: showRemote ? syncedRemote(ref) : undefined }))
  return <button className={'commit-row '+(selected?'selected ':'')+(contextActive?'context-active ':'')+(isHead?'head ':'')+(!matches?'dim ':'')+(commit.parents.length > 1 ? 'merge':'')} onClick={() => onSelect(commit)} onContextMenu={event => { event.preventDefault(); onContext(commit, event.clientX, event.clientY, event.currentTarget) }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContext(commit, rect.left + 20, rect.bottom, event.currentTarget) } }}><Graph row={row} head={isHead} rowHeight={rowHeight} palette={palette}/><span className="commit-message">{isHead && <span className="head-badge" title="Estás aquí: HEAD apunta a este commit">HEAD</span>}{visibleRefs.map(({ ref, synced }) => <RefLabel key={ref} name={ref} lane={row.col} synced={synced} palette={palette} onContext={onRefContext} onOpen={onRefOpen}/>)}<span className="subject">{commit.subject}</span></span><span className="date">{date(commit.date)}</span><span className="author">{commit.author}</span><span className="hash">{commit.hash.slice(0,8)}</span></button>
})

const OVERSCAN = 12
const LOAD_AHEAD = 60

const CommitList = React.memo(function CommitList({ rowHeight, rows, hasMore, loadingMore, selectedHash, contextHash, visibleHashes, query, showRemote, palette, remotes, onSelect, onContext, onRefContext, onRefOpen, onLoadMore }: CommitListProps) {
  const needle = query.toLowerCase()
  const scroller = useRef<any>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setView(old => old.top === el.scrollTop && old.height === el.clientHeight ? old : { top: el.scrollTop, height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => { el.removeEventListener('scroll', update); observer.disconnect() }
  }, [])
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN)
  useEffect(() => { if (hasMore && !loadingMore && end >= rows.length - LOAD_AHEAD) onLoadMore() }, [hasMore, loadingMore, end, rows.length, onLoadMore])
  return <div className="commit-list" ref={scroller}>{rows.length === 0 ? <div className="no-results">Este repositorio todavía no tiene commits.</div> : <>
    <div style={{ paddingTop: start * rowHeight, paddingBottom: (rows.length - end) * rowHeight }}>{rows.slice(start, end).map(row => {
      const c = row.commit
      const matches = (!visibleHashes || visibleHashes.has(c.hash)) && (!needle || `${c.subject} ${c.message} ${c.author} ${c.email} ${c.hash} ${c.refs.join(' ')}`.toLowerCase().includes(needle))
      return <CommitRow key={c.hash} row={row} rowHeight={rowHeight} selected={selectedHash === c.hash} contextActive={contextHash === c.hash} matches={matches} showRemote={showRemote} palette={palette} remotes={remotes} onSelect={onSelect} onContext={onContext} onRefContext={onRefContext} onRefOpen={onRefOpen}/>
    })}</div>
    {(hasMore || loadingMore) && <div className="history-more" role="status">{loadingMore ? <><LoaderCircle className="spin" size={14}/> Cargando más historial…</> : 'Desplázate para cargar más'}</div>}
  </>}</div>
})

function ProjectsPage({ projects, folders, defaultProject, busy, onAdd, onOpen, onDefault, onRemove, onFolderAction, onMove }) {
  const [search, setSearch] = useState('')
  const dragProject = useRef<any>(null), [dragging, setDragging] = useState<any>(null), [dropGroup, setDropGroup] = useState(undefined)
  const endDrag = () => { dragProject.current = null; setDragging(null); setDropGroup(undefined) }
  const [collapsed, setCollapsed] = useState(() => new Set()), [folderDialog, setFolderDialog] = useState<any>(null), [folderError, setFolderError] = useState('')
  const query = search.trim().toLocaleLowerCase('es')
  const matches = value => value.toLocaleLowerCase('es').includes(query)
  const ungrouped = projects.filter(project => !project.folderId || !folders.some(folder => folder.id === project.folderId))
  const groups = [
    ...folders.map(folder => ({ ...folder, projects: projects.filter(project => project.folderId === folder.id) })),
    { id: null, name: 'Sin carpeta', projects: ungrouped },
  ].map(group => ({ ...group, visible: query && !matches(group.name) ? group.projects.filter(project => matches(project.path)) : group.projects }))
    .filter(group => query ? matches(group.name) || group.visible.length : group.id !== null || group.projects.length || !folders.length || dragging)
  const toggleGroup = id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  async function submitFolder(event) {
    event.preventDefault(); setFolderError('')
    try { await onFolderAction(folderDialog.type, folderDialog.folder?.id, folderDialog.name); setFolderDialog(null) }
    catch (error) { setFolderError(error.message || String(error)) }
  }
  return <section className="projects-page"><div className="projects-page-inner">
    <div className="projects-page-heading">
      <div className="projects-heading-copy"><div className="projects-overline"><span className="projects-overline-icon"><GitMerge size={14}/></span> TU ESPACIO DE TRABAJO</div><h1>Tus proyectos</h1><p>Todos tus repositorios, en un mismo lugar.</p></div>
      <div className="projects-page-actions"><button className="projects-new-folder" disabled={busy} onClick={() => { setFolderError(''); setFolderDialog({ type: 'create', name: '' }) }}><FolderPlus size={16}/> Nueva carpeta</button><button className="open-cta projects-add" disabled={busy} onClick={onAdd}><Plus size={16}/> Añadir proyecto</button></div>
    </div>
    <div className="projects-library">
      <div className="projects-library-head"><div><h2>Repositorios <span>{projects.length}</span></h2><p>Selecciona un proyecto para ver su historial.</p></div><label className="projects-search"><Search size={15}/><input aria-label="Buscar proyectos" placeholder="Buscar proyectos…" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
      {groups.length && (projects.length || folders.length) ? <div className="project-cards">{groups.map(group => <section className={'project-group'+(dropGroup === group.id ? ' drop-target' : '')} key={group.id || 'ungrouped'} onDragOver={event => {
        const source = projects.find(project => project.path === dragProject.current)
        if (!source || busy || (source.folderId || null) === group.id || (!source.folderId && group.id === null)) return
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroup(group.id)
      }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropGroup(previous => previous === group.id ? undefined : previous) }} onDrop={event => {
        const path = dragProject.current; if (!path || dropGroup !== group.id) return
        event.preventDefault(); endDrag(); onMove(path, group.id)
      }}>
        {(folders.length > 0 || group.id) && <div className="project-group-heading"><button className="project-group-toggle" aria-expanded={query ? true : !collapsed.has(group.id)} onClick={() => toggleGroup(group.id)}>{query || !collapsed.has(group.id) ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<Folder size={15}/><strong>{group.name}</strong><span>{group.projects.length}</span></button>{group.id && <div className="project-group-actions"><button className="tool-button" aria-label={'Renombrar carpeta ' + group.name} title="Renombrar carpeta" disabled={busy} onClick={() => { setFolderError(''); setFolderDialog({ type: 'rename', folder: group, name: group.name }) }}><Pencil size={14}/></button><button className="tool-button" aria-label={'Eliminar carpeta ' + group.name} title="Eliminar carpeta" disabled={busy} onClick={() => { setFolderError(''); setFolderDialog({ type: 'delete', folder: group, name: group.name }) }}><Trash2 size={14}/></button></div>}</div>}
        {(query || !collapsed.has(group.id)) && <>{group.visible.length ? group.visible.map(project => <article className={'project-card'+(dragging === project.path ? ' dragging' : '')} key={project.path} draggable={!busy && folders.length > 0} onDragStart={event => { dragProject.current = project.path; setDragging(project.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.path) }} onDragEnd={endDrag}>
          <button className="project-card-main" title={project.path} disabled={busy} onClick={() => onOpen(project.path)}><span className="project-card-icon"><FolderGit2 size={18}/></span><span className="project-card-text"><span className="project-name-line"><strong>{project.path.split(/[\\/]/).filter(Boolean).pop() || project.path}</strong>{defaultProject === project.path && <em><Star size={10} fill="currentColor"/> Predeterminado</em>}</span><small>{project.path}</small></span><span className="project-open-label">Abrir <ChevronRight size={15}/></span></button>
          <div className="project-card-actions">{folders.length > 0 && <select className="project-folder-select" aria-label={'Carpeta de ' + project.path} title="Mover a una carpeta" value={project.folderId || ''} disabled={busy} onChange={event => onMove(project.path, event.target.value || null)}><option value="">Sin carpeta</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>}<button className={'default-button '+(defaultProject === project.path ? 'is-default' : '')} title={defaultProject === project.path ? 'Quitar como predeterminado' : 'Establecer como predeterminado'} aria-label={(defaultProject === project.path ? 'Quitar como predeterminado: ' : 'Establecer como predeterminado: ') + project.path} aria-pressed={defaultProject === project.path} disabled={busy} onClick={() => onDefault(project.path)}><Star size={15} fill={defaultProject === project.path ? 'currentColor' : 'none'}/></button><button className="tool-button project-forget" title="Quitar de la lista" aria-label={'Quitar proyecto ' + project.path} disabled={busy} onClick={() => onRemove(project.path)}><X size={16}/></button></div>
        </article>) : <p className="folder-empty">{dragging && group.id === null ? 'Suelta aquí para sacar el proyecto de su carpeta.' : 'Esta carpeta aún no tiene proyectos.'}</p>}</>}
      </section>)}</div> : <div className="projects-empty"><span className="projects-empty-icon">{projects.length || folders.length ? <Search size={20}/> : <FolderGit2 size={20}/>}</span><strong>{projects.length || folders.length ? 'No hay coincidencias' : 'Todavía no hay proyectos'}</strong><span>{projects.length || folders.length ? 'Prueba con otro nombre o ruta.' : 'Añade un repositorio para empezar a explorar.'}</span>{!projects.length && !folders.length && <button className="projects-empty-add" disabled={busy} onClick={onAdd}>Añadir un proyecto <span>→</span></button>}</div>}
      <div className="projects-library-footer"><Star size={13}/><span>Marca un proyecto con la estrella para abrirlo al iniciar.</span></div>
    </div>
  </div>{folderDialog && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setFolderDialog(null) }}><form className="action-dialog folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); setFolderDialog(null) } }} onSubmit={submitFolder}><h2 id="folder-dialog-title">{folderDialog.type === 'create' ? 'Nueva carpeta' : folderDialog.type === 'rename' ? 'Renombrar carpeta' : 'Eliminar carpeta'}</h2>{folderDialog.type === 'delete' ? <p>Los proyectos de «{folderDialog.name}» pasarán a <strong>Sin carpeta</strong>. Sus archivos no se modificarán.</p> : <label className="action-label">Nombre de la carpeta<input autoFocus required maxLength={80} value={folderDialog.name} onChange={event => setFolderDialog({ ...folderDialog, name: event.target.value })} placeholder="Por ejemplo, Trabajo"/></label>}{folderError && <div className="action-error" role="alert">{folderError}</div>}<div className="action-buttons"><button type="button" autoFocus={folderDialog.type === 'delete'} disabled={busy} onClick={() => setFolderDialog(null)}>Cancelar</button><button className={folderDialog.type === 'delete' ? 'danger' : 'confirm'} disabled={busy || (folderDialog.type !== 'delete' && !folderDialog.name.trim())} type="submit">{busy ? 'Guardando…' : folderDialog.type === 'create' ? 'Crear carpeta' : folderDialog.type === 'rename' ? 'Guardar' : 'Eliminar carpeta'}</button></div></form></div>}</section>
}

function statusText(status) {
  const parts: string[] = []
  if (status.dirty) parts.push(status.dirty + ' cambios sin confirmar')
  if (status.ahead) parts.push(status.ahead + ' commits por enviar')
  if (status.behind) parts.push(status.behind + ' commits por recibir')
  return parts.length ? '\n' + parts.join(' · ') : ''
}

function SyncBar({ repo, busy, syncing, onSync, onPickBranch }) {
  const info = repo.sync?.[repo.branch], detached = repo.branch === 'HEAD separado'
  const [menu, setMenu] = useState(false), box = useRef<any>(null)
  useEffect(() => {
    if (!menu) return
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !box.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [menu])
  const icon = (kind, Icon) => syncing === kind ? <LoaderCircle className="spin" size={15}/> : <Icon size={15}/>
  const run = kind => { setMenu(false); onSync(kind) }
  const pullTitle = info ? `Pull desde ${info.upstream}` + (info.behind ? ` (${info.behind} por recibir)` : '') : 'Pull'
  const pushTitle = info ? `Push a ${info.upstream}` + (info.ahead ? ` (${info.ahead} por enviar)` : '') : 'Push (publicará la rama)'
  return <><div className="scm-row">
    <button className="branch-button" title="Cambiar de rama" aria-label={'Rama actual: ' + repo.branch + '. Cambiar de rama'} disabled={busy} onClick={onPickBranch}><GitBranch size={15}/><strong>{repo.branch}</strong><ChevronDown size={14}/></button>
    <button className="sync-icon" title={pullTitle} aria-label={pullTitle} disabled={busy || detached} onClick={() => onSync('pull')}>{icon('pull', ArrowDown)}{info?.behind > 0 && <b aria-hidden="true">{info.behind > 99 ? '99+' : info.behind}</b>}</button>
    <button className="sync-icon" title={pushTitle} aria-label={pushTitle} disabled={busy || detached} onClick={() => onSync('push')}>{icon('push', ArrowUp)}{info?.ahead > 0 && <b aria-hidden="true">{info.ahead > 99 ? '99+' : info.ahead}</b>}</button>
    <div className="sync-menu-wrap" ref={box}>
      <button className="sync-icon" title="Más acciones" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}>{syncing === 'fetch' ? <LoaderCircle className="spin" size={15}/> : <Ellipsis size={16}/>}</button>
      {menu && <div className="sync-menu" role="menu">
        <button role="menuitem" onClick={() => run('fetch')}><CloudDownload size={14}/>Fetch<small>Actualiza todos los remotos y etiquetas; elimina referencias remotas obsoletas</small></button>
        <button role="menuitem" disabled={detached} onClick={() => run('pull')}><ArrowDown size={14}/>Pull<small>{info ? 'Desde ' + info.upstream + ' · solo avance rápido' : 'Recibir cambios · solo avance rápido'}</small></button>
        <button role="menuitem" disabled={detached} onClick={() => run('push')}><ArrowUp size={14}/>Push<small>{info ? 'Envía commits a ' + info.upstream : 'Publica la rama y configura su seguimiento'}</small></button>
      </div>}
    </div>
  </div>
  <div className="git-status" role="status">
    {detached ? 'HEAD separado: no hay una rama activa para sincronizar.' : !info ? 'Esta rama no tiene una rama de seguimiento configurada.' : info.gone ? `La rama de seguimiento ${info.upstream} ya no existe.` : <><strong>{info.ahead} commits por enviar · {info.behind} por recibir</strong><span>Comparado con {info.upstream}; datos del último fetch.</span></>}
  </div></>
}

const TAB_COLORS = PROJECT_COLORS
function useStoredState(key, initial) {
  const [value, setValue] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved ?? initial } catch { return initial } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }, [key, value])
  return [value, setValue]
}

function ProjectTabs({ onSaveAppearance, onHideFolder, onMoveTab, groupTabs, showUngroupedLabel, tabLabelWidth, folders, statuses, projects: allProjects, savedProjects, activeProject, defaultProject, showProjects, loadingProject, refreshingProject, busy, onProjects, onOpen, onAdd, onReorder, onReorderFolders, onClose }) {
  const dragging = useRef<any>(null)
  const addMenuRef = useRef<any>(null), [addMenuOpen, setAddMenuOpen] = useState(false), [addMenuAlign, setAddMenuAlign] = useState('left'), [addMenuQuery, setAddMenuQuery] = useState(''), [addMenuSearchOpen, setAddMenuSearchOpen] = useState(false)
  useEffect(() => {
    if (!addMenuOpen) return
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !addMenuRef.current?.contains(event.target)) setAddMenuOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [addMenuOpen])
  const [collapsed, setCollapsed] = useStoredState('gitgraph.collapsedGroups', []), [colors, setColors] = useStoredState('gitgraph.tabColors', {}), [colorMenu, setColorMenu] = useState<any>(null)
  const grouped = groupTabs && folders.length > 0
  const tabGroups = useMemo(() => {
    if (!grouped) return [{ key: 'all', label: null, items: allProjects.map((project, index) => ({ project, index })) }]
    const defs = [...folders.map(folder => ({ key: 'f:' + folder.id, label: folder.name, projects: allProjects.filter(project => project.folderId === folder.id) })), { key: 'f:none', label: showUngroupedLabel ? 'Sin carpeta' : null, projects: allProjects.filter(project => !project.folderId || !folders.some(folder => folder.id === project.folderId)) }]
    let index = 0
    return defs.filter(def => def.projects.length).map(def => ({ key: def.key, label: def.label, items: def.projects.map(project => ({ project, index: index++ })) }))
  }, [allProjects, folders, grouped, showUngroupedLabel])
  const projects = useMemo(() => tabGroups.flatMap(group => group.items.map(item => item.project)), [tabGroups])
  const availableProjects = savedProjects.filter(project => !allProjects.some(open => open.path === project.path))
  const toggleGroup = id => setCollapsed(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id])
  const setColor = (key, color) => {
    if (!key.startsWith('f:')) { setColorMenu(null); setColors(old => { if (!(key in old)) return old; const next = { ...old }; delete next[key]; return next }); onSaveAppearance(key, { color: color || null }).catch(() => {}); return }
    setColors(old => { const next = { ...old }; if (color) next[key] = color; else delete next[key]; return next }); setColorMenu(null) }
  useEffect(() => {
    const onKey = event => {
      if (busy || !event.ctrlKey || event.altKey || event.metaKey || !projects.length) return
      let target: { path: string } | null | undefined = null
      if (/^[1-9]$/.test(event.key)) target = event.key === '9' ? projects[projects.length - 1] : projects[Number(event.key) - 1]
      else if (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp') {
        const backwards = event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey), current = showProjects ? -1 : projects.findIndex(project => project.path === activeProject)
        target = projects[current < 0 ? (backwards ? projects.length - 1 : 0) : (current + (backwards ? -1 : 1) + projects.length) % projects.length]
      }
      if (!target) return
      event.preventDefault(); onOpen(target.path)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [projects, activeProject, showProjects, busy, onOpen])
  useEffect(() => {
    if (!colorMenu) return
    const close = event => { if (event.type === 'keydown' && event.key !== 'Escape') return; setColorMenu(null) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close) }
  }, [colorMenu])
  const listRef = useRef<any>(null), [overflow, setOverflow] = useState({ left: false, right: false, any: false })
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onWheel = event => { if (list.scrollWidth > list.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); list.scrollLeft += event.deltaY } }
    const update = () => setOverflow({ left: list.scrollLeft > 1, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1, any: list.scrollWidth > list.clientWidth + 1 })
    update(); list.addEventListener('wheel', onWheel, { passive: false }); list.addEventListener('scroll', update)
    const observer = new ResizeObserver(update); observer.observe(list); if (list.firstElementChild) [...list.children].forEach(child => observer.observe(child))
    return () => { list.removeEventListener('wheel', onWheel); list.removeEventListener('scroll', update); observer.disconnect() }
  }, [projects.length, collapsed, grouped])
  const scrollTabs = direction => listRef.current?.scrollBy({ left: direction * Math.max(160, listRef.current.clientWidth * .6), behavior: 'smooth' })
  useEffect(() => { if (!showProjects) [...(listRef.current?.querySelectorAll('.projects-tab') ?? [])].find(tab => tab.dataset.projectPath === activeProject)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [activeProject, showProjects, projects.length, collapsed])
  const openColorMenu = (event, key) => { event.preventDefault(); setColorMenu({ key, x: Math.min(event.clientX, window.innerWidth - 190), y: event.clientY }) }
  const [dragPath, setDragPath] = useState<any>(null), [target, setTarget] = useState<any>(null), [tabGroupTarget, setTabGroupTarget] = useState<any>(null)
  const folderOf = key => key === 'f:none' ? null : key.slice(2)
  const folderDragRef = useRef<any>(null), [folderDrag, setFolderDrag] = useState<any>(null), [folderTarget, setFolderTarget] = useState<any>(null)
  function clearFolderDrag() { folderDragRef.current = null; setFolderDrag(null); setFolderTarget(null) }
  function clearDrag() { dragging.current = null; setDragPath(null); setTarget(null); setTabGroupTarget(null) }
  return <nav className="project-tabs" aria-label="Proyectos" style={{ '--tab-label-width': tabLabelWidth + 'px' } as React.CSSProperties}>
    <button className={'projects-tab '+(showProjects ? 'active' : '')} aria-current={showProjects ? 'page' : undefined} onClick={onProjects}><FolderOpen size={15}/> Proyectos</button>
    <span id="project-tabs-help" className="visually-hidden">Arrastra las pestañas para cambiar su orden o usa Alt y las flechas izquierda y derecha.</span>
    {overflow.any && <button className="tabs-scroll" aria-label="Desplazar pestañas a la izquierda" disabled={!overflow.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={14}/></button>}<div className="project-tabs-list" ref={listRef}>{tabGroups.map(group => { const isCollapsed = group.label !== null && collapsed.includes(group.key), groupColor = colors[group.key]; return <div key={group.key} className={'tab-group'+(group.label === null ? ' plain' : '')+(folderTarget?.key === group.key ? ' drop-' + folderTarget.side : '')+(isCollapsed ? ' collapsed' : '')+(tabGroupTarget === group.key ? ' drop-tab' : '')} style={groupColor ? { '--group-color': groupColor } as React.CSSProperties : undefined} role="group" aria-label={group.label === null ? undefined : 'Carpeta ' + group.label} onDragOver={event => {
      if (dragging.current && grouped) { const source = projects.find(item => item.path === dragging.current), sameGroup = source && group.items.some(item => item.project.path === source.path); if (!sameGroup) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTabGroupTarget(group.key) } return }
      if (!folderDragRef.current || folderDragRef.current === group.key) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect(), side = group.key === 'f:none' || event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before'
      setFolderTarget(previous => previous?.key === group.key && previous.side === side ? previous : { key: group.key, side })
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTabGroupTarget(previous => previous === group.key ? null : previous); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderTarget(previous => previous?.key === group.key ? null : previous) }} onDrop={event => {
      if (dragging.current && grouped) { event.preventDefault(); const path = dragging.current; clearDrag(); if (!group.items.some(item => item.project.path === path)) onMoveTab(path, folderOf(group.key), null); return }
      if (!folderDragRef.current || folderDragRef.current === group.key) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect(), none = group.key === 'f:none'
      const side = none || event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before', targetKey = none ? 'f:' + folders[folders.length - 1]?.id : group.key
      const next = moveProjectTab(folders.map(folder => ({ path: 'f:' + folder.id, folder })), folderDragRef.current, targetKey, side).map(item => item.folder)
      onReorderFolders(next); clearFolderDrag()
    }}>{group.label !== null && <button className={'tab-group-label'+(group.key !== 'f:none' && folderDrag === group.key ? ' dragging' : '')} aria-expanded={!isCollapsed} title={(isCollapsed ? 'Expandir' : 'Contraer') + ' «' + group.label + '»\nClic derecho para elegir un color' + (group.key !== 'f:none' ? '\nArrastra para reordenar' : '')} onClick={() => toggleGroup(group.key)} onContextMenu={event => openColorMenu(event, group.key)} draggable={!busy && group.key !== 'f:none'} onDragStart={event => {
      folderDragRef.current = group.key; setFolderDrag(group.key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.key)
    }} onDragEnd={clearFolderDrag}>{isCollapsed ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}<Folder size={12}/><span>{group.label}</span>{isCollapsed && <em>{group.items.length}</em>}</button>}{group.label !== null && group.key !== 'f:none' && <button className="tab-group-hide" title="Ocultar carpeta (los proyectos siguen en Proyectos)" aria-label={'Ocultar carpeta ' + group.label} disabled={busy} onClick={() => onHideFolder(folderOf(group.key))}><X size={11}/></button>}{group.label !== null && !isCollapsed && <span className="tab-group-sep" aria-hidden="true"/>}{group.items.filter(({ project }) => !isCollapsed || (!showProjects && project.path === activeProject)).map(({ project, index }) => { const color = project.color || colors[project.path] || colors[group.key], status = statuses[project.path]; return <button key={project.path} style={color ? { '--tab-color': color } as React.CSSProperties : undefined} onContextMenu={event => openColorMenu(event, project.path)} data-project-path={project.path} className={'projects-tab '+(color ? (project.color ? colorClasses(project) : 'colored ') : '')+(status?.dirty > 0 ? 'has-dirty ' : '')+(status?.ahead > 0 ? 'has-ahead ' : '')+(status?.behind > 0 ? 'has-behind ' : '')+(!showProjects && activeProject === project.path ? 'active ' : '')+(dragPath === project.path ? 'dragging ' : '')+(target?.path === project.path ? `drop-${target.side}` : '')} aria-current={!showProjects && activeProject === project.path ? 'page' : undefined} aria-describedby="project-tabs-help" title={project.path + '\nArrastra para reordenar' + (status ? statusText(status) : '')} disabled={busy} draggable={!busy} onClick={() => onOpen(project.path)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(project.path) } }} onDragStart={event => {
      dragging.current = project.path; setDragPath(project.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.path)
    }} onDragOver={event => {
      if (!dragging.current || dragging.current === project.path) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      setTarget(previous => previous?.path === project.path && previous.side === side ? previous : { path: project.path, side })
    }} onDragLeave={() => {
      setTarget(previous => previous?.path === project.path ? null : previous)
    }} onDrop={event => {
      if (!dragging.current || dragging.current === project.path) return
      event.preventDefault(); event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after', path = dragging.current
      const crossFolder = grouped && !group.items.some(item => item.project.path === path)
      clearDrag()
      if (crossFolder) onMoveTab(path, folderOf(group.key), project.path, side)
      else onReorder(moveProjectTab(projects, path, project.path, side))
    }} onDragEnd={clearDrag} onKeyDown={event => {
      if (event.key === 'Delete' && !busy) { event.preventDefault(); onClose(project.path); return }
      if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const offset = event.key === 'ArrowLeft' ? -1 : 1
      const other = projects[index + offset]
      if (!other) return
      event.preventDefault(); onReorder(moveProjectTab(projects, project.path, other.path, offset < 0 ? 'before' : 'after'), project.path)
    }}>{loadingProject === project.path || refreshingProject === project.path ? <LoaderCircle className="spin" size={15} role="img" aria-label={loadingProject === project.path ? 'Cargando proyecto' : 'Actualizando proyecto'}/> : <ProjectIcon project={project}/>}<span>{projectName(project)}</span>{defaultProject === project.path && <Star className="default-star" size={12} fill="currentColor"/>}{status?.dirty > 0 && <i className="tab-dirty" role="img" aria-label={status.dirty + ' cambios sin confirmar'}/>}{status?.ahead > 0 && <b className="tab-sync" aria-label={status.ahead + ' commits por enviar'}>↑{status.ahead}</b>}{status?.behind > 0 && <b className="tab-sync" aria-label={status.behind + ' commits por recibir'}>↓{status.behind}</b>}<span className="tab-close" aria-hidden="true" title="Ocultar pestaña (Supr)" onClick={event => { event.stopPropagation(); if (!busy) onClose(project.path) }}><X size={12}/></span></button> })}</div> })}</div>
    {colorMenu && <div className="tab-color-menu" role="menu" aria-label="Color" style={{ left: colorMenu.x, top: colorMenu.y }} onPointerDown={event => event.stopPropagation()}>{TAB_COLORS.map(color => <button key={color} role="menuitem" aria-label={'Color ' + color} className={(allProjects.find(project => project.path === colorMenu.key)?.color || colors[colorMenu.key]) === color ? 'selected' : ''} style={{ background: color }} onClick={() => setColor(colorMenu.key, color)}/>)}<button role="menuitem" className="tab-color-clear" onClick={() => setColor(colorMenu.key, null)}>Sin color</button></div>}
    {overflow.any && <button className="tabs-scroll" aria-label="Desplazar pestañas a la derecha" disabled={!overflow.right} onClick={() => scrollTabs(1)}><ChevronRight size={14}/></button>}
    <div className="add-project-wrap" ref={addMenuRef}>
      <button className="tool-button add-project-tab" title="Añadir proyecto" aria-label="Añadir proyecto" aria-haspopup="menu" aria-expanded={addMenuOpen} disabled={busy} onClick={() => { if (!addMenuOpen && addMenuRef.current) { const rect = addMenuRef.current.getBoundingClientRect(); setAddMenuAlign(window.innerWidth - rect.left >= 230 ? 'left' : 'right') } setAddMenuQuery(''); setAddMenuSearchOpen(false); setAddMenuOpen(open => !open) }}><Plus size={16}/></button>
      {addMenuOpen && <div className={"add-project-menu align-" + addMenuAlign} role="menu" aria-label="Añadir proyecto">
        {availableProjects.length > 0 && <><div className="add-project-heading"><span>Proyectos guardados</span><button className="add-project-search-toggle" type="button" aria-label={addMenuSearchOpen ? "Cerrar búsqueda" : "Buscar proyecto"} aria-expanded={addMenuSearchOpen} onClick={() => { setAddMenuSearchOpen(open => !open); setAddMenuQuery('') }}><Search size={14}/></button></div>{addMenuSearchOpen && <input className="add-project-search" type="search" placeholder="Buscar proyecto…" aria-label="Buscar proyecto" value={addMenuQuery} onChange={event => setAddMenuQuery(event.target.value)} autoFocus/>}<div className="add-project-list">{availableProjects.filter(project => projectName(project).toLocaleLowerCase().includes(addMenuQuery.trim().toLocaleLowerCase())).map(project => { const groupKey = grouped ? (folders.some(folder => folder.id === project.folderId) ? 'f:' + project.folderId : 'f:none') : 'all', color = project.color || colors[project.path] || colors[groupKey]; return <button key={project.path} role="menuitem" className={'add-project-item ' + (color ? (project.color ? colorClasses(project) : 'colored ') : '')} style={color ? { '--tab-color': color } as React.CSSProperties : undefined} onClick={() => { setAddMenuOpen(false); onOpen(project.path) }}><ProjectIcon project={project}/><span>{projectName(project)}</span></button> })}{!availableProjects.some(project => projectName(project).toLocaleLowerCase().includes(addMenuQuery.trim().toLocaleLowerCase())) && <div className="add-project-empty">No hay coincidencias</div>}</div></>}
        <button className="add-project-new" role="menuitem" onClick={() => { setAddMenuOpen(false); onAdd() }}><FolderOpen size={15}/><span>Abrir un proyecto nuevo</span></button>
      </div>}
    </div>
  </nav>
}

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
  const [projects, setProjects] = useState<any[]>([]), [folders, setFolders] = useState<any[]>([]), [activeProject, setActiveProject] = useState<any>(null)
  const [statuses, setStatuses] = useState({}), [defaultProject, setDefaultProject] = useState<any>(null), [showProjects, setShowProjects] = useState(true)
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
    let failure: string | null = null
    try {
      if (kind === 'sync') {
        await window.gitGraph.fetch(root)
        const refreshed = await window.gitGraph.load(root, showRemote, repo.commits.length)
        const info = refreshed.sync?.[refreshed.branch]
        if (!info || info.gone) throw new Error('La rama de seguimiento ya no está disponible tras el fetch. No se ha hecho pull ni push.')
        if (info.behind) await window.gitGraph.pull(root)
        if (info?.ahead) await window.gitGraph.push(root)
        setNotice('Sincronización completada')
      } else { await window.gitGraph[kind](root); setNotice(kind === 'fetch' ? 'Fetch completado' : kind === 'pull' ? 'Pull completado' : 'Push completado') }
    } catch (e) { failure = e.message || String(e); setError(failure) }
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
      const [selection, refreshed] = await Promise.allSettled([
        window.gitGraph.projects.select(path),
        window.gitGraph.load(cached.repo.root, remote, cached.repo.commits.length),
      ])
      if (request !== projectRequest.current) return
      setRefreshingProject(null)
      if (selection.status === 'rejected') setError(`No se pudo guardar la selección: ${selection.reason?.message || String(selection.reason)}`)
      if (refreshed.status === 'fulfilled') {
        projectCache.current.set(path, { repo: refreshed.value, showRemote: remote })
        setRepo(refreshed.value); setSelected(old => updatedSelection(refreshed.value, old))
      } else setError(`No se pudo actualizar «${path}»: ${refreshed.reason?.message || String(refreshed.reason)}`)
      return
    }
    setBusy(true); setError(''); setRefreshingProject(null); setLoadingProject(path)
    setActiveProject(path); setRepo(null); setSelected(null); setFilter('all'); setQuery(''); setShowProjects(false)
    try {
      const result = await window.gitGraph.projects.open(path, remote)
      if (request !== projectRequest.current) return
      projectCache.current.set(path, { repo: result.repo, showRemote: remote })
      setProjects(result.state.projects); setActiveProject(result.state.activeProject); setRepo(result.repo); setSelected(null); setFilter('all'); setQuery(''); setShowProjects(false)
    } catch (e) { if (request === projectRequest.current) setError(`No se pudo abrir el proyecto «${path}»: ${e.message || String(e)}`) } finally { if (request === projectRequest.current) { setLoadingProject(null); setBusy(false) } }
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
  async function setDefault(path) {
    setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.setDefault(path); setDefaultProject(state.defaultProject) }
    catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  async function folderAction(type, id, name) {
    setBusy(true)
    try {
      const state = type === 'create' ? await window.gitGraph.projects.createFolder(name) : type === 'rename' ? await window.gitGraph.projects.renameFolder(id, name) : await window.gitGraph.projects.deleteFolder(id)
      setFolders(state.folders); setProjects(state.projects)
    } finally { setBusy(false) }
  }
  async function moveProject(path, folderId) {
    setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.move(path, folderId); setFolders(state.folders); setProjects(state.projects) }
    catch (error) { setError(error.message || String(error)) } finally { setBusy(false) }
  }
  async function moveTab(path, folderId, targetPath, side) {
    setBusy(true); setError('')
    try {
      let state = await window.gitGraph.projects.move(path, folderId)
      if (targetPath) state = await window.gitGraph.projects.reorder(moveProjectTab(state.projects, path, targetPath, side).map(project => project.path))
      setFolders(state.folders ?? folders); setProjects(state.projects)
    } catch (error) { setError(error.message || String(error)) } finally { setBusy(false) }
  }
  async function saveProjectAppearance(path, patch) {
    const current = projects.find(project => project.path === path) || {}
    setBusy(true)
    try { const state = await window.gitGraph.projects.setAppearance(path, { name: current.name, icon: current.icon, color: current.color, colorTargets: current.colorTargets, ...patch }); setProjects(state.projects) }
    finally { setBusy(false) }
  }
  async function saveProjectCommand(path, command) {
    setBusy(true)
    try { const state = await window.gitGraph.projects.setCommand(path, command); setProjects(state.projects) }
    finally { setBusy(false) }
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
  const [hiddenTabs, setHiddenTabs] = useStoredState('gitgraph.hiddenTabs', [])
  const [hiddenFolders, setHiddenFolders] = useStoredState('gitgraph.hiddenFolders', [])
  const isTabHidden = project => hiddenTabs.includes(project.path) || (groupTabs && hiddenFolders.includes(project.folderId))
  const visibleProjects = useMemo(() => projects.filter(project => !isTabHidden(project)), [projects, hiddenTabs, hiddenFolders, groupTabs])
  useEffect(() => {
    const active = !showProjects && projects.find(project => project.path === activeProject)
    if (!active) return
    if (hiddenTabs.includes(active.path)) setHiddenTabs(old => old.filter(path => path !== active.path))
    if (active.folderId && hiddenFolders.includes(active.folderId)) setHiddenFolders(old => old.filter(id => id !== active.folderId))
  }, [activeProject, showProjects, projects, hiddenTabs, hiddenFolders])
  function hideTab(path) {
    setHiddenTabs(old => old.includes(path) ? old : [...old, path])
    if (activeProject === path && !showProjects) setShowProjects(true)
  }
  function hideFolder(folderId) {
    setHiddenFolders(old => old.includes(folderId) ? old : [...old, folderId])
    if (!showProjects && projects.find(project => project.path === activeProject)?.folderId === folderId) setShowProjects(true)
  }
  function reorderTabs(nextVisible, focusPath) {
    const queue = [...nextVisible]
    return reorderProjects(projects.map(project => isTabHidden(project) ? project : queue.shift()), focusPath)
  }
  async function reorderProjects(next, focusPath) {
    if (next === projects || next.every((project, index) => project.path === projects[index]?.path)) return
    const previous = projects
    setProjects(next); setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.reorder(next.map(project => project.path)); setProjects(state.projects) }
    catch (error) { setProjects(previous); setError(error.message || String(error)) }
    finally {
      setBusy(false)
      if (focusPath) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('.project-tabs-list button')].find(button => button.dataset.projectPath === focusPath)?.focus())
    }
  }
  async function reorderFolders(next) {
    if (next.every((folder, index) => folder.id === folders[index]?.id)) return
    const previous = folders
    setFolders(next); setBusy(true); setError('')
    try { const state = await window.gitGraph.projects.reorderFolders(next.map(folder => folder.id)); setFolders(state.folders) }
    catch (error) { setFolders(previous); setError(error.message || String(error)) }
    finally { setBusy(false) }
  }
  function toggleDefault(path) { return setDefault(defaultProject === path ? null : path) }
  const [aiSettings, setAISettings] = useState({ showAI: true, showAIAgent: true, showAIReview: true, showAICommit: true, showAIImprovements: true, agentModel: 'claude-sonnet-5-5', chatModel: '', summaryModel: 'claude-haiku-5-5', reviewModel: '', commitModel: 'claude-haiku-5-5', improvementsModel: '' })
  async function changeSetting(key, value) {
    const previous: any = key in aiSettings ? aiSettings[key] : key === 'explorerIconsOnly' ? explorerIconsOnly : key === 'leftOpen' ? leftOpen : key === 'rightOpen' ? rightOpen : key === 'groupTabs' ? groupTabs : key === 'showUngroupedLabel' ? showUngroupedLabel : key === 'tabLabelWidth' ? tabLabelWidth : key === 'autoFetchMinutes' ? autoFetchMinutes : key === 'layoutDensity' ? layoutDensity : key === 'theme' ? theme : key === 'branchPalette' ? branchPalette : showRemote
    const version = (settingVersions.current[key] || 0) + 1
    settingVersions.current[key] = version
    if (key === 'showRemote') { ++projectRequest.current; setRefreshingProject(null); setBusy(true) }
    if (key in aiSettings) setAISettings(old => ({ ...old, [key]: value }))
    else if (key === 'leftOpen') setLeftOpen(value)
    else if (key === 'rightOpen') setRightOpen(value)
    else if (key === 'groupTabs') setGroupTabs(value)
    else if (key === 'explorerIconsOnly') setExplorerIconsOnly(value)
    else if (key === 'showUngroupedLabel') setShowUngroupedLabel(value)
    else if (key === 'tabLabelWidth') setTabLabelWidth(value)
    else if (key === 'autoFetchMinutes') setAutoFetchMinutes(value)
    else if (key === 'layoutDensity') setLayoutDensity(value)
    else if (key === 'theme') setTheme(value)
    else if (key === 'branchPalette') setBranchPalette(value)
    else if (key === 'showRemote') { setShowRemote(value); setFilter('all') }
    try {
      await window.gitGraph.settings.set(key, value)
      if (key === 'showRemote' && repo) await load(false, value)
    } catch (e) {
      if (settingVersions.current[key] === version) {
        if (key in aiSettings) setAISettings(old => ({ ...old, [key]: previous }))
        else if (key === 'leftOpen') setLeftOpen(previous)
        else if (key === 'rightOpen') setRightOpen(previous)
        else if (key === 'groupTabs') setGroupTabs(previous)
        else if (key === 'explorerIconsOnly') setExplorerIconsOnly(previous)
        else if (key === 'showUngroupedLabel') setShowUngroupedLabel(previous)
        else if (key === 'tabLabelWidth') setTabLabelWidth(previous)
        else if (key === 'autoFetchMinutes') setAutoFetchMinutes(previous)
        else if (key === 'layoutDensity') setLayoutDensity(previous)
        else if (key === 'theme') setTheme(previous)
        else if (key === 'branchPalette') setBranchPalette(previous)
        else if (key === 'showRemote') setShowRemote(previous)
      }
      setError(e.message || String(e))
    }
    finally { if (key === 'showRemote') setBusy(false) }
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
  const latest = useRef<any>({})
  latest.current = { repo, busy, showRemote, activeProject }
  useEffect(() => window.gitGraph.onRestored(async () => {
    const before = latest.current
    if (!before.repo) return
    const root = before.repo.root, request = projectRequest.current
    try {
      await window.gitGraph.fetch(root)
      const now = latest.current
      if (request !== projectRequest.current || now.busy || now.repo?.root !== root) return
      const data = await window.gitGraph.load(root, now.showRemote, now.repo.commits.length)
      const after = latest.current
      if (request !== projectRequest.current || after.busy || after.repo?.root !== root) return
      projectCache.current.set(after.activeProject, { repo: data, showRemote: after.showRemote }); setRepo(data); setSelected(old => updatedSelection(data, old))
    } catch (e) {
      if (latest.current.repo?.root === root) setError('No se pudo hacer fetch al restaurar: ' + (e.message || String(e)))
    }
  }), [])
  useEffect(() => {
    if (!autoFetchMinutes || !repo || showProjects || showSettings) return
    const root = repo.root
    const tick = async () => {
      const before = latest.current
      if (document.hidden || before.busy || before.repo?.root !== root) return
      const request = projectRequest.current
      try {
        await window.gitGraph.fetch(root)
        const now = latest.current
        if (request !== projectRequest.current || now.busy || now.repo?.root !== root) return
        const data = await window.gitGraph.load(root, now.showRemote, now.repo.commits.length)
        const after = latest.current
        if (request !== projectRequest.current || after.busy || after.repo?.root !== root) return
        projectCache.current.set(after.activeProject, { repo: data, showRemote: after.showRemote }); setRepo(data); setSelected(old => updatedSelection(data, old))
      } catch {}
    }
    const timer = setInterval(tick, autoFetchMinutes * 60000)
    return () => clearInterval(timer)
  }, [autoFetchMinutes, repo?.root, showProjects, showSettings])
  const projectPaths = projects.map(project => project.path).join('\n')
  useEffect(() => {
    if (!projectPaths) { setStatuses({}); return }
    let cancelled = false
    const refresh = () => { if (document.hidden) return; window.gitGraph.projects.status(projectPaths.split('\n')).then(result => { if (!cancelled) setStatuses(result) }).catch(() => {}) }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [projectPaths, repo])
  useEffect(() => {
    const onRefreshKey = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      if (!event.repeat && repo && !busy && !showProjects && !showSettings) void load()
    }
    window.addEventListener('keydown', onRefreshKey, true)
    return () => window.removeEventListener('keydown', onRefreshKey, true)
  }, [repo, busy, showProjects, showSettings, showRemote, activeProject])
  useEffect(() => { if (!repo || !selected) { setDiff({ text: '' }); return }; let active = true; setDiff({ loading: true, text: '' }); window.gitGraph.diff(repo.root, selected.hash).then(value => { if (active) setDiff({ text: value }) }).catch(e => { if (active) setDiff({ text: '', error: 'No se pudo cargar el diff: ' + (e.message || e) }) }); return () => { active = false } }, [repo?.root, selected?.hash])
  useEffect(() => { const onKey = e => { if (showSettings && ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')))) { e.preventDefault(); document.querySelector<HTMLInputElement>('.settings-search input')?.focus(); return } if (!showSettings && (((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')))) { e.preventDefault(); setSearchOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>('.search-input')?.focus(), 0) } if (!showSettings && e.key === 'Escape') setSelected(null) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [showSettings])
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



