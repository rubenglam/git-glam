import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, GitBranch, LoaderCircle, Plus, RefreshCw, Sparkles, Square } from 'lucide-react'

export function BranchPicker({ dir, onClose, onDone, onManage }) {
  const [data, setData] = useState<any>(null), [query, setQuery] = useState(''), [index, setIndex] = useState(0), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const listRef = useRef<any>(null)
  useEffect(() => { let active = true; window.gitGraph.branches(dir).then(result => { if (active) setData(result) }).catch(e => { if (active) setError(e.message || String(e)) }); return () => { active = false } }, [dir])
  const rows = useMemo(() => {
    if (creating || !data) return []
    const text = query.trim().toLowerCase()
    return [{ kind: 'create' }, ...data.branches.filter(branch => !text || branch.name.toLowerCase().includes(text)).map(branch => ({ kind: 'branch', branch }))]
  }, [data, query, creating])
  useEffect(() => { setIndex(0) }, [query, creating])
  useEffect(() => { listRef.current?.querySelector('.picker-row.active')?.scrollIntoView({ block: 'nearest' }) }, [index])
  async function perform(task) {
    setBusy(true); setError('')
    try { await task(); onDone() } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }
  function choose(row) {
    if (busy || !row) return
    if (row.kind === 'create') { setCreating(true); setQuery(''); return }
    if (row.branch.name === data.current && !row.branch.remote) { onClose(); return }
    perform(() => window.gitGraph.switchBranch(dir, row.branch.ref))
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); if (creating) { setCreating(false); setQuery('') } else onClose() }
    else if (creating) { if (event.key === 'Enter') { event.preventDefault(); if (query.trim()) perform(() => window.gitGraph.createBranch(dir, query.trim())) } }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(old => Math.min(old + 1, rows.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(old => Math.max(old - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(rows[index]) }
  }
  return <div className="picker-backdrop" onMouseDown={onClose}>
    <div className="picker" role="dialog" aria-label="Cambiar de rama" onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}>
      <input className="picker-input" autoFocus value={query} disabled={busy} aria-label={creating ? 'Nombre de la nueva rama' : 'Filtrar ramas'} placeholder={creating ? 'Nombre de la nueva rama (Enter para crear, Esc para volver)' : 'Seleccionar una rama para cambiar'} onChange={event => setQuery(event.target.value)}/>
      {error && <div className="picker-error" role="alert">{error}</div>}
      {!creating && <div className="picker-list" ref={listRef} role="listbox">
        {!data && !error && <div className="picker-empty"><LoaderCircle className="spin" size={14}/> Cargando ramas…</div>}
        {rows.map((row, position) => row.kind === 'create'
          ? <button key="create" role="option" aria-selected={index === position} className={'picker-row picker-create '+(index === position ? 'active' : '')} onMouseEnter={() => setIndex(position)} onClick={() => choose(row)}><Plus size={15}/><span>Crear nueva rama…</span></button>
          : <button key={row.branch.ref} role="option" aria-selected={index === position} className={'picker-row '+(index === position ? 'active' : '')} onMouseEnter={() => setIndex(position)} onClick={() => choose(row)} onContextMenu={event => { event.preventDefault(); onManage?.(row.branch, event) }}>
            <GitBranch size={15}/>
            <span className="picker-main"><span className="picker-name"><strong>{row.branch.name}</strong>{row.branch.remote && <em>remota</em>}<small>{row.branch.date}</small>{row.branch.name === data.current && !row.branch.remote && <Check size={13}/>}</span><span className="picker-sub">{row.branch.author} • {row.branch.hash} • {row.branch.subject}</span></span>
          </button>)}
        {data && rows.length === 1 && query && <div className="picker-empty">Ninguna rama coincide</div>}
      </div>}
    </div>
  </div>
}

export function CommitBox({ dir, changes, publishedTo, disabled, sync, syncing, onSync, onCommitted, onError }) {
  const [message, setMessage] = useState(''), [generating, setGenerating] = useState(false), [committing, setCommitting] = useState(false), [amend, setAmend] = useState(false)
  const loaded = useRef(''), run = useRef<string | null>(null), textarea = useRef<HTMLTextAreaElement>(null), drag = useRef<{ y: number; height: number } | null>(null)
  useEffect(() => () => { if (run.current) { window.gitGraph.cancelCommitMessage(run.current).catch(() => {}); run.current = null } }, [dir])
  const staged = changes.some(change => change.status[0] !== ' ' && change.status[0] !== '?')
  const working = generating || committing
  async function generate() {
    const id = crypto.randomUUID()
    run.current = id; setGenerating(true)
    try { const result = await window.gitGraph.generateCommitMessage(dir, id); if (run.current === id) setMessage(result) } catch (e) { if (run.current === id) onError(e.message || String(e)) } finally { if (run.current === id) { run.current = null; setGenerating(false) } }
  }
  function stopGeneration() {
    const id = run.current
    if (id) { run.current = null; setGenerating(false); window.gitGraph.cancelCommitMessage(id).catch(e => onError(e.message || String(e))) }
  }
  async function toggleAmend(on) {
    setAmend(on)
    if (on && !message.trim()) {
      try { const last = await window.gitGraph.lastMessage(dir); loaded.current = last; setMessage(last) } catch (e) { onError(e.message || String(e)) }
    } else if (!on && loaded.current && message === loaded.current) { loaded.current = ''; setMessage('') }
  }
  async function commit(push = false) {
    setCommitting(true)
    try { await window.gitGraph[push ? 'commitAndPush' : 'commit'](dir, message, { amend }); setMessage(''); setAmend(false); loaded.current = ''; await onCommitted(amend, push) } catch (e) {
      // The commit itself may have succeeded even though the push failed: refresh first (it clears errors), then report.
      if (push && /commit se creó/.test(e.message || '')) { setMessage(''); setAmend(false); loaded.current = ''; await onCommitted(amend, false) }
      onError(e.message || String(e))
    } finally { setCommitting(false) }
  }
  const showSync = !amend && changes.length === 0 && sync && !sync.gone && (sync.ahead > 0 || sync.behind > 0)
  const unavailable = disabled || working || (!amend && changes.length === 0)
  const blocked = unavailable || (!amend && !message.trim())
  return <div className="commit-box">
    <div className="commit-input-wrap">
      <textarea ref={textarea} rows={2} value={message} disabled={disabled || committing} aria-label="Mensaje de commit" placeholder={amend ? 'Mensaje del commit enmendado (vacío = conservar el actual)' : 'Mensaje (Ctrl+Enter para confirmar)'} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !blocked) { event.preventDefault(); commit() } }}/>
      <button className="commit-ai" title={generating ? "Detener generaci�n" : "Generar mensaje con IA (Claude Haiku)"} aria-label={generating ? "Detener generaci�n" : "Generar mensaje de commit con IA"} disabled={!generating && (disabled || committing || changes.length === 0)} onClick={generating ? stopGeneration : generate}>{generating ? <Square size={14} fill="currentColor"/> : <Sparkles size={15}/>}</button>
      <div className="commit-resize" aria-hidden="true" onPointerDown={event => { if (!textarea.current) return; drag.current = { y: event.clientY, height: textarea.current.offsetHeight }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }} onPointerMove={event => { if (drag.current && textarea.current) textarea.current.style.height = `${Math.max(58, drag.current.height + event.clientY - drag.current.y)}px` }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}/>
    </div>
    <label className="commit-amend"><input type="checkbox" checked={amend} disabled={disabled || working} onChange={event => toggleAmend(event.target.checked)}/> Enmendar el último commit</label>
    {amend && publishedTo && <p className="commit-warn" role="note">Este commit ya está en {publishedTo}. Enmendarlo reescribe el historial y requerirá un push forzado.</p>}
    {showSync ? <div className="commit-split">
      <button className="commit-button" disabled={disabled || syncing} title={`Sincronizar con ${sync.upstream}`} onClick={onSync}>{syncing ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} Sincronizar cambios{sync.behind > 0 && ` ${sync.behind}↓`}{sync.ahead > 0 && ` ${sync.ahead}↑`}</button>
    </div> : <div className="commit-split">
      <button className="commit-button" disabled={blocked} title={amend ? 'Reemplaza el último commit con los cambios preparados y el mensaje indicado' : staged ? 'Confirma solo los cambios en el área de preparación' : 'Prepara y confirma todos los cambios'} onClick={() => commit(false)}>{committing ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} {amend ? 'Enmendar commit' : staged ? 'Confirmar cambios preparados' : 'Confirmar todo'}</button>
      {!amend && <button className="commit-button commit-push" disabled={blocked} title="Confirmar y enviar (push) a la rama remota" aria-label="Confirmar y hacer push" onClick={() => commit(true)}><ArrowUp size={15}/></button>}
    </div>}
  </div>
}
