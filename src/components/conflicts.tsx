import { useEffect, useState } from 'react'

export function Conflicts({ root, version, onRefresh }) {
  const [state, setState] = useState<any>(null), [open, setOpen] = useState(false), [file, setFile] = useState(''), [original, setOriginal] = useState(''), [content, setContent] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const api = () => window.gitGraph
  async function refresh() { const next = await api().conflictState(root); setState(next); return next }
  useEffect(() => {
    let active = true
    const check = () => api().conflictState(root).then(next => { if (active) setState(next) }).catch(() => {})
    check()
    const timer = setInterval(check, 5000); window.addEventListener('focus', check)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [root, version])
  async function execute(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message || String(e)) }
    finally { try { await refresh() } catch (e) { setError(e.message || String(e)) }; setBusy(false) }
  }
  async function select(path) {
    if (file && content !== original && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return
    setFile(''); setError('')
    await execute(async () => { const text = await api().conflictRead(root, path); setFile(path); setOriginal(text); setContent(text) })
  }
  if (!state || (!state.operation && !state.files.length)) return null
  return <>
    <div className="conflict-banner" role="status"><strong>{state.operation ? `${state.operation} en curso` : 'Conflictos pendientes'}</strong><span>{state.files.length} archivo(s) sin resolver</span><button onClick={() => setOpen(true)}>{state.files.length ? 'Resolver conflictos' : 'Gestionar operación'}</button></div>
    {open && <div className="dialog-backdrop"><div className="action-dialog conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <h2 id="conflict-title">Resolver conflictos{state.operation ? ` · ${state.operation}` : ''}</h2>
      <p>Edita los archivos, guarda la resolución y márcalos como resueltos. Para una eliminación, marca el archivo como resuelto sin abrirlo.</p>
      <div className="conflict-layout"><div className="conflict-files">{state.files.length ? state.files.map(path => <div className="conflict-file" key={path}><button title={path} disabled={busy} onClick={() => select(path)}>{path}</button><button disabled={busy} onClick={() => execute(() => api().fileAction(root, path, 'open'))}>Abrir fuera</button><button disabled={busy || (file === path && content !== original)} onClick={() => execute(async () => { await api().stage(root, [path]); if (file === path) setFile(''); await onRefresh() })}>Marcar resuelto</button></div>) : <p>No quedan archivos sin resolver.</p>}</div>
      <div className="conflict-editor">{file ? <><strong>{file}</strong><textarea aria-label={'Contenido de ' + file} spellCheck={false} value={content} onChange={e => setContent(e.target.value)}/><button disabled={busy || content === original} onClick={() => execute(async () => { await api().conflictSave(root, file, original, content); setOriginal(content) })}>Guardar archivo</button></> : <p>Selecciona un archivo para editarlo.</p>}</div></div>
      {state.operation && <p className="action-notice">Continuar completará o reanudará la operación con las resoluciones preparadas. Abortar intentará volver al estado anterior y puede descartar las resoluciones realizadas.</p>}
      {error && <div className="action-error" role="alert">{error}</div>}
      <div className="action-buttons"><button disabled={busy} onClick={() => { if (content !== original && file && !window.confirm('Hay cambios sin guardar. ¿Cerrar igualmente?')) return; setOpen(false); setFile('') }}>Cerrar</button><button disabled={busy} onClick={() => execute(async () => { await refresh(); await onRefresh() })}>Actualizar</button>{state.operation && <><button disabled={busy} onClick={() => { if (window.confirm(`¿Abortar ${state.operation}? Git intentará volver al estado anterior a la operación.`)) execute(async () => { await api().conflictAction(root, state.operation, 'abort'); setFile(''); await onRefresh(); setOpen(false) }) }}>Abortar operación</button><button className="confirm" disabled={busy || state.files.length > 0} onClick={() => execute(async () => { try { await api().conflictAction(root, state.operation, 'continue') } finally { await onRefresh() }; const next = await refresh(); if (!next.operation && !next.files.length) setOpen(false) })}>Continuar</button></>}</div>
    </div></div>}
  </>
}

