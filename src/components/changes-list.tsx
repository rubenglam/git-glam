import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, ListTree, Minus, Plus, Sparkles, Undo2 } from 'lucide-react'
import { FileIcon } from './file-icon.tsx'
import { buildFileTree } from '../lib/file-tree.ts'
import { sortChanges, statusLetter } from '../lib/change-sort.ts'
import type { FileChange } from '../types.ts'

export const isStaged = (change: FileChange) => change.status[0] !== ' ' && change.status[0] !== '?'
export const isUnstaged = (change: FileChange) => change.status[1] !== ' ' || change.status === '??'

const filePaths = (node: any): string[] => node.type === 'file' ? [node.path] : node.children.flatMap(filePaths)
const Guides = ({ depth }) => Array.from({ length: depth }, (_, index) => <i className="tree-guide" key={index}/>)

function ToggleButton({ staged, busy, paths, label, onToggle }: { staged?: boolean; busy: boolean; paths: string[]; label?: string; onToggle: (paths: string[]) => void }) {
  return <button className="change-toggle" disabled={busy} title={(staged ? 'Quitar del área de preparación' : 'Preparar') + (label ? ': ' + label : '')} aria-label={(staged ? 'Quitar del área de preparación: ' : 'Preparar: ') + (label || paths.join(', '))} onClick={() => onToggle(paths)}>{staged ? <Minus size={14}/> : <Plus size={14}/>}</button>
}

function DiscardButton({ busy, paths, label, onDiscard }: { busy: boolean; paths: string[]; label?: string; onDiscard: (paths: string[]) => void }) {
  if (!onDiscard) return null
  return <button className="change-toggle change-discard" disabled={busy} title={'Descartar cambios' + (label ? ': ' + label : '')} aria-label={'Descartar cambios: ' + (label || paths.join(', '))} onClick={() => onDiscard(paths)}><Undo2 size={14}/></button>
}

function ChangeRow({ change, staged, active, busy, depth = 0, onPick, onToggle, onDiscard, onContext }: any) {
  const raw = statusLetter(change, staged)
  const kind = raw === 'D' ? 'deleted' : raw === 'M' ? 'modified' : 'added'
  const dir = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''
  const nested = depth !== undefined
  return <div className={'change-row' + (active ? ' active' : '')} title={`${change.status} ${change.path}`} onContextMenu={event => { event.preventDefault(); onContext(change, staged, event.clientX, event.clientY) }}>
    <button className={'change-open' + (nested ? ' in-tree' : '')} aria-pressed={active} onClick={() => onPick({ path: change.path, staged, untracked: change.status === '??' })}>{nested && <><Guides depth={depth}/><i className="tree-twisty"/></>}<FileIcon path={change.path}/><span>{change.path.split('/').pop()}{!nested && <small>{dir}</small>}</span></button>
    <b className={'change-status ' + kind}>{raw}</b>
    <DiscardButton busy={busy} paths={[change.path]} onDiscard={onDiscard}/>
    <ToggleButton staged={staged} busy={busy} paths={[change.path]} onToggle={onToggle}/>
  </div>
}

function TreeRows({ nodes, depth, parentKey, byPath, collapsed, onCollapse, ...row }) {
  return nodes.map(node => {
    if (node.type === 'file') return <ChangeRow key={'f:' + node.path} change={byPath.get(node.path)} depth={depth} active={row.selected?.path === node.path && row.selected.staged === row.staged} {...row}/>
    const key = parentKey + '/' + node.label, closed = collapsed.has(key), paths = filePaths(node)
    return <React.Fragment key={'d:' + key}>
      <div className="change-row change-dir">
        <button className="change-open in-tree" title={node.label.replaceAll(' / ', '/')} aria-expanded={!closed} onClick={() => onCollapse(key)}><Guides depth={depth}/><i className="tree-twisty">{closed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</i>{closed ? <Folder size={14}/> : <FolderOpen size={14}/>}<span>{node.label}</span></button>
        <span className="change-count">{paths.length}</span>
        <DiscardButton busy={row.busy} paths={paths} label={node.label.replaceAll(' / ', '/')} onDiscard={row.onDiscard}/>
        <ToggleButton staged={row.staged} busy={row.busy} paths={paths} label={node.label.replaceAll(' / ', '/')} onToggle={row.onToggle}/>
      </div>
      {!closed && <TreeRows nodes={node.children} depth={depth + 1} parentKey={key} byPath={byPath} collapsed={collapsed} onCollapse={onCollapse} {...row}/>}
    </React.Fragment>
  })
}

function Section({ title, staged, items, open, onOpen, selected, busy, tree, sort, viewToggle, onPick, onToggle, onDiscard, onContext, onReview, empty }: any) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const flip = key => setCollapsed(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const row = { staged, selected, busy, onPick, onToggle, onDiscard, onContext }
  return <>
    <div className="changes-heading-row">
      <button className="section-toggle changes-heading" aria-expanded={open} onClick={() => onOpen(!open)}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>} {title} <span className="change-count">{items.length}</span></button>
      {viewToggle}
      {onReview && <button className="change-toggle" disabled={busy} title="Resumir cambios preparados con IA" aria-label="Resumir cambios preparados con IA" onClick={onReview}><Sparkles size={14}/></button>}
      {items.length > 0 && <DiscardButton busy={busy} paths={items.map(change => change.path)} label="todos los cambios" onDiscard={onDiscard}/>}
      {items.length > 0 && <ToggleButton staged={staged} busy={busy} paths={items.map(change => change.path)} label={staged ? 'todo' : 'todos los cambios'} onToggle={onToggle}/>}
    </div>
    {open && <div className="change-list">{items.length
      ? tree ? <TreeRows nodes={buildFileTree(items)} depth={0} parentKey="" byPath={new Map(items.map(change => [change.path, change]))} collapsed={collapsed} onCollapse={flip} {...row}/>
        : sortChanges(items, sort, staged).map(change => <ChangeRow key={change.path} change={change} active={selected?.path === change.path && selected.staged === staged} {...row}/>)
      : empty && <p className="panel-empty">{empty}</p>}</div>}
  </>
}

const MIN_PANE = 60
const SORTS = [['status', 'Ordenar cambios por estado'], ['name', 'Ordenar cambios por nombre'], ['path', 'Ordenar cambios por ruta de acceso']]
const stored = (key, valid, fallback) => { try { const value = localStorage.getItem(key); return valid.includes(value) ? value : fallback } catch { return fallback } }
const remember = (key, value) => { try { localStorage.setItem(key, value) } catch {} }

function ViewMenu({ tree, sort, onTree, onSort }) {
  const [open, setOpen] = useState(false), box = useRef<any>(null)
  useEffect(() => {
    if (!open) return
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !box.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const item = (checked, label, run) => <button role="menuitemradio" aria-checked={checked} className="view-item" onClick={() => { run(); setOpen(false) }}><span>{checked && <Check size={14}/>}</span>{label}</button>
  return <div className="view-menu" ref={box}>
    <button className="change-toggle view-toggle" title="Ver y ordenar" aria-label="Ver y ordenar" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><ListTree size={14}/></button>
    {open && <div className="view-popup" role="menu">
      {item(tree, 'Ver como árbol', () => onTree(true))}{item(!tree, 'Ver como lista', () => onTree(false))}
      <hr/>
      {SORTS.map(([mode, label]) => item(sort === mode, label, () => onSort(mode)))}
    </div>}
  </div>
}

export function ChangesList({ changes, selected, busy, onPick, onStage, onUnstage, onDiscard, onContext, onReview }) {
  const [stagedOpen, setStagedOpen] = useState(true), [unstagedOpen, setUnstagedOpen] = useState(true)
  const [tree, setTree] = useState(() => stored('changesView', ['tree', 'list'], 'list') === 'tree'), [sort, setSort] = useState(() => stored('changesSort', SORTS.map(([mode]) => mode), 'path'))
  const staged = changes.filter(isStaged), unstaged = changes.filter(isUnstaged)
  const viewToggle = <ViewMenu tree={tree} sort={sort} onTree={value => { setTree(value); remember('changesView', value ? 'tree' : 'list') }} onSort={mode => { setSort(mode); remember('changesSort', mode) }}/>
  const area = useRef<any>(null), pane = useRef<any>(null), drag = useRef<any>(null)
  const [height, setHeight] = useState(() => { try { const value = Number(localStorage.getItem('stagedHeight')); return value >= MIN_PANE ? value : null } catch { return null } })
  const maxHeight = () => Math.max(MIN_PANE, (area.current?.clientHeight || 600) - MIN_PANE - 40)
  const resize = value => { const next = Math.max(MIN_PANE, Math.min(Math.round(value), maxHeight())); setHeight(next); remember('stagedHeight', String(next)) }
  const split = staged.length > 0 && stagedOpen && unstagedOpen
  const finish = event => { if (drag.current?.id === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } }
  return <div className="changes-area" ref={area}>
    {staged.length > 0 && <div className="changes-pane" ref={pane} style={stagedOpen ? height === null ? { flex: '0 1 auto', maxHeight: '60%' } : { flex: `0 0 ${Math.min(height, maxHeight())}px` } : { flex: 'none' }}><Section title="PREPARADOS" staged items={staged} open={stagedOpen} onOpen={setStagedOpen} selected={selected} busy={busy} tree={tree} sort={sort} viewToggle={viewToggle} onPick={onPick} onToggle={onUnstage} onContext={onContext} onReview={onReview}/></div>}
    {split && <div className="cd-sep cd-sep-row" role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Ajustar altura de los cambios preparados" aria-valuemin={MIN_PANE} aria-valuemax={maxHeight()} aria-valuenow={Math.round(pane.current?.offsetHeight || 0)} title="Arrastra para redimensionar; doble clic para restablecer"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { id: event.pointerId, y: event.clientY, h: pane.current.offsetHeight }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (drag.current?.id === event.pointerId) resize(drag.current.h + event.clientY - drag.current.y) }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }}
      onDoubleClick={() => { setHeight(null); remember('stagedHeight', '') }}
      onKeyDown={event => { const now = pane.current.offsetHeight, step = event.shiftKey ? 40 : 10; if (event.key === 'ArrowDown') resize(now + step); else if (event.key === 'ArrowUp') resize(now - step); else return; event.preventDefault() }}/>}
    <div className="changes-pane" style={{ flex: unstagedOpen ? '1 1 0' : 'none' }}><Section title="CAMBIOS" staged={false} items={unstaged} open={unstagedOpen} onOpen={setUnstagedOpen} selected={selected} busy={busy} tree={tree} sort={sort} viewToggle={staged.length ? null : viewToggle} onPick={onPick} onToggle={onStage} onDiscard={onDiscard} onContext={onContext} empty={staged.length ? 'Todo está preparado.' : 'No hay cambios pendientes.'}/></div>
  </div>
}
