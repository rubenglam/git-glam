import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, File, Folder, FolderOpen, Maximize2, Minimize2, X } from 'lucide-react'
import { buildFileTree } from './file-tree.ts'
import { DiffView } from './diff-view.tsx'
import { FileIcon } from './file-icon.tsx'

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
const COL_MIN = 170, DIFF_MIN = 220, ROW_MIN = 150

function Splitter({ orientation, label, value, min, max, onResize }) {
  const drag = useRef<any>(null)
  const horizontal = orientation === 'horizontal' // horizontal bar between rows, resizes height
  const finish = event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } }
  return <div className={'cd-sep ' + (horizontal ? 'cd-sep-row' : 'cd-sep-col')} role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, start: horizontal ? event.clientY : event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={event => { if (drag.current?.pointerId !== event.pointerId) return; const delta = (horizontal ? event.clientY : event.clientX) - drag.current.start; onResize(drag.current.value + (horizontal ? -delta : delta)) }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      const step = event.shiftKey ? 40 : 10, grow = horizontal ? 'ArrowUp' : 'ArrowRight', shrink = horizontal ? 'ArrowDown' : 'ArrowLeft'
      if (event.key === grow) onResize(value + step); else if (event.key === shrink) onResize(value - step); else if (event.key === 'Home') onResize(min); else if (event.key === 'End') onResize(max); else return
      event.preventDefault()
    }}/>
}

function TreeNodes({ nodes, depth, parentKey, selectedPath, collapsed, onToggle, onPick, onContext }) {
  const guides = Array.from({ length: depth }, (_, index) => <i className="tree-guide" key={index}/>)
  return nodes.map(node => {
    if (node.type === 'file') return <button key={'f:' + node.path} className={'tree-row tree-file' + (selectedPath === node.path ? ' active' : '')} title={node.path} aria-pressed={selectedPath === node.path} onClick={() => onPick(node.path)} onContextMenu={event => { event.preventDefault(); onContext(node.path, event.clientX, event.clientY) }}>{guides}<i className="tree-twisty"/><FileIcon path={node.path} size={14}/><span className="tree-name">{node.name}</span><span className="tree-stats">{node.binary ? <em>binario</em> : <><b className="plus">+{node.added}</b><b className="minus">−{node.deleted}</b></>}</span></button>
    const key = parentKey + '/' + node.label, closed = collapsed.has(key)
    return <React.Fragment key={'d:' + key}>
      <button className="tree-row tree-dir" title={node.label.replaceAll(' / ', '/')} aria-expanded={!closed} onClick={() => onToggle(key)}>{guides}<i className="tree-twisty">{closed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</i>{closed ? <Folder size={14}/> : <FolderOpen size={14}/>}<span className="tree-name">{node.label}</span></button>
      {!closed && <TreeNodes nodes={node.children} depth={depth + 1} parentKey={key} selectedPath={selectedPath} collapsed={collapsed} onToggle={onToggle} onPick={onPick} onContext={onContext}/>}
    </React.Fragment>
  })
}

export function CommitDetails({ commit, root, diff, formatDate, onSelectHash, onClose, onFileContext }) {
  const [files, setFiles] = useState<any>(null), [filesError, setFilesError] = useState(''), [selectedPath, setSelectedPath] = useState<any>(null), [collapsed, setCollapsed] = useState(() => new Set()), [copied, setCopied] = useState(false)
  const [filesWidth, setFilesWidth] = useState(300), [height, setHeight] = useState<any>(null), [expanded, setExpanded] = useState(false), [showAll, setShowAll] = useState(false), [bodyOpen, setBodyOpen] = useState(false)
  const section = useRef<any>(null)
  useLayoutEffect(() => { if (height === null && section.current?.parentElement) setHeight(clamp(Math.round(section.current.parentElement.clientHeight * 0.55), ROW_MIN, Math.max(ROW_MIN, section.current.parentElement.clientHeight - 140))) }, [height])
  useEffect(() => {
    let active = true
    setFiles(null); setFilesError(''); setSelectedPath(null); setShowAll(false); setBodyOpen(false); setCollapsed(new Set())
    window.gitGraph.commitFiles(root, commit.hash).then(value => { if (active) setFiles(value) }).catch(error => { if (active) { setFiles([]); setFilesError(error.message || String(error)) } })
    return () => { active = false }
  }, [root, commit.hash])
  const tree = useMemo(() => files ? buildFileTree(files) : [], [files])
  const totals = useMemo(() => (files || []).reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 }), [files])
  const toggle = key => setCollapsed(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const copy = () => { navigator.clipboard.writeText(commit.hash); setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const total = () => section.current?.clientWidth || 1000
  const diffVisible = showAll || selectedPath !== null
  const maxFiles = Math.max(COL_MIN, total() - DIFF_MIN - 6)
  const maxHeight = () => Math.max(ROW_MIN, (section.current?.parentElement?.clientHeight || 700) - 140)
  const currentHeight = () => expanded ? maxHeight() : height ?? Math.round((section.current?.parentElement?.clientHeight || 600) * 0.55)
  const body = commit.message.startsWith(commit.subject) ? commit.message.slice(commit.subject.length).trim() : commit.message
  return <>
    <Splitter orientation="horizontal" label="Ajustar altura del detalle del commit" value={currentHeight()} min={ROW_MIN} max={maxHeight()} onResize={value => { setExpanded(false); setHeight(clamp(value, ROW_MIN, maxHeight())) }}/>
    <section ref={section} className="details commit-details" aria-label="Detalles del commit" style={{ height: expanded ? maxHeight() : height ?? 320, gridTemplateColumns: diffVisible ? `minmax(${COL_MIN}px,${filesWidth}px) 6px minmax(${DIFF_MIN}px,1fr)` : 'minmax(0,1fr)' }}>
      <header className="cd-head">
        <div className="cd-head-main">
          {commit.stash && <span className="detail-stash">STASH · {commit.stash}</span>}
          <strong className="cd-subject">{commit.subject}</strong>
          <div className="cd-meta-line">
            <span className="cd-author">{commit.author} <a className="cd-link" href={'mailto:' + commit.email}>&lt;{commit.email}&gt;</a></span>
            <span className="cd-dot">·</span><span>{formatDate(commit.date)}</span>
            <span className="cd-dot">·</span><code title={commit.hash}>{commit.hash.slice(0, 10)}</code>
            {commit.parents.length > 0 && <><span className="cd-dot">·</span><span>{commit.parents.length > 1 ? 'Padres' : 'Padre'} {commit.parents.map(parent => <button key={parent} className="cd-link" title={parent} onClick={() => onSelectHash(parent)}>{parent.slice(0, 8)}</button>)}</span></>}
          </div>
          {body && <div className="cd-body-wrap"><p className={'cd-body' + (bodyOpen ? ' open' : '')}>{body}</p>{(body.length > 220 || body.includes('\u000a')) && <button className="cd-more" aria-expanded={bodyOpen} onClick={() => setBodyOpen(!bodyOpen)}>{bodyOpen ? 'Ver menos' : 'Ver más'}</button>}</div>}
        </div>
        <div className="cd-actions"><button className="tool-button" title="Copiar hash completo" aria-label="Copiar hash" onClick={copy}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button><button className="tool-button" title={expanded ? 'Restaurar tamaño' : 'Ampliar panel'} aria-label={expanded ? 'Restaurar tamaño' : 'Ampliar panel'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button><button className="tool-button" title="Cerrar detalles" aria-label="Cerrar detalles" onClick={onClose}><X size={17}/></button></div>
      </header>
      <div className="cd-files">
        <div className="cd-files-head"><span>ARCHIVOS</span>{files && <span className="cd-count">{files.length}</span>}{files?.length > 0 && <span className="tree-stats cd-total"><b className="plus">+{totals.added}</b><b className="minus">−{totals.deleted}</b></span>}{files?.length > 0 && <button className="cd-clear" onClick={() => { if (selectedPath) { setSelectedPath(null); setShowAll(true) } else setShowAll(!showAll) }}>{selectedPath ? 'Ver todo el diff' : showAll ? 'Ocultar diff' : 'Ver todo el diff'}</button>}</div>
        <div className="cd-tree">{files === null ? <p className="panel-empty">Cargando archivos…</p> : filesError ? <p className="panel-empty">{filesError}</p> : files.length ? <div className="cd-tree-inner"><TreeNodes nodes={tree} depth={0} parentKey="" selectedPath={selectedPath} collapsed={collapsed} onToggle={toggle} onContext={(path, x, y) => onFileContext(path, commit.hash, x, y)} onPick={path => { setShowAll(false); setSelectedPath(old => old === path ? null : path) }}/></div> : <p className="panel-empty">Este commit no modifica archivos.</p>}</div>
      </div>
      {diffVisible && <>
      <Splitter orientation="vertical" label="Ajustar ancho del árbol de archivos" value={filesWidth} min={COL_MIN} max={maxFiles} onResize={value => setFilesWidth(clamp(value, COL_MIN, maxFiles))}/>
      <DiffView diff={diff} path={selectedPath}/>
      </>}
    </section>
  </>
}
