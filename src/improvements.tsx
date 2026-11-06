import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy, Lightbulb, LoaderCircle, Plus, Trash2, X } from 'lucide-react'

type Improvement = { id: string; title: string; description: string; files: string[]; effort: string; createdAt: number }

const REQUEST = `Analiza este repositorio (solo lectura) y propón entre 6 y 8 mejoras concretas y de valor: funcionalidades, UX, rendimiento, calidad de código o tests.
Responde ÚNICAMENTE con un array JSON válido, sin texto antes ni después ni bloque de código, donde cada elemento tenga:
{"title": "título corto", "description": "qué mejorar y por qué, 1-3 frases", "files": ["rutas relevantes"], "effort": "bajo|medio|alto"}
Escribe los textos en español.`

// Appends the already-known ideas so the agent proposes only new ones.
export function buildRequest(known: Improvement[]): string {
  if (!known.length) return REQUEST
  const list = known.map(item => `- ${item.title}: ${item.description}`).join('\n')
  return `${REQUEST}\n\nYa somos conscientes de estas mejoras (no las repitas ni propongas variantes de ellas):\n${list}\n\nPropón solo mejoras nuevas y distintas.`
}

// Extracts the JSON array from the agent reply, tolerating code fences or surrounding prose.
export function parseImprovements(text: string): Improvement[] {
  const now = Date.now()
  const start = text.indexOf('['), end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('El agente no devolvió una lista válida')
  const data = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(data)) throw new Error('El agente no devolvió una lista válida')
  const items = data.filter(item => item && typeof item.title === 'string').map((item, index) => ({
    id: crypto.randomUUID(), createdAt: now + index,
    title: item.title.trim(),
    description: String(item.description || '').trim(),
    files: Array.isArray(item.files) ? item.files.map(String) : [],
    effort: String(item.effort || '').trim(),
  }))
  if (!items.length) throw new Error('El agente no propuso ninguna mejora')
  return items
}

export function buildPrompt(project: string, item: Improvement, notes: string): string {
  const lines = [
    `Trabaja en el proyecto "${project}".`,
    '',
    `Objetivo: ${item.title}`,
    '',
    item.description,
  ]
  if (item.files.length) lines.push('', 'Archivos relacionados:', ...item.files.map(file => `- ${file}`))
  if (notes.trim()) lines.push('', 'Notas adicionales:', notes.trim())
  lines.push('', 'Antes de cambiar nada, revisa el código existente y sigue sus convenciones (código nuevo en TypeScript). Haz cambios mínimos y enfocados, y explica brevemente qué has modificado.')
  return lines.join('\n')
}

// Asks the agent (read-only) for improvement ideas, lets the user pick one and builds a prompt to paste into another app.
export function ImprovementsDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const [items, setItems] = useState<Improvement[]>([]), [selected, setSelected] = useState<string | null>(null), [loaded, setLoaded] = useState(false), [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const runId = useRef<string | null>(null), buffer = useRef(''), itemsRef = useRef(items)
  itemsRef.current = items
  const project = root.split(/[\\/]/).pop() || root

  useEffect(() => {
    let live = true
    window.gitGraph.improvements.load(root).then(saved => { if (live) { setItems(saved || []); setLoaded(true) } }, () => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [root])
  const persist = (next: Improvement[]) => {
    setItems(next)
    window.gitGraph.improvements.save(root, next).catch(failure => setError(failure.message || String(failure)))
  }

  useEffect(() => window.gitGraph.agent.onEvent((id, event) => {
    if (id !== runId.current) return
    if (event.type === 'delta') buffer.current += event.text
    if (event.type !== 'done') return
    runId.current = null; setBusy(false)
    if (event.cancelled) return
    if (event.error) { setError(event.text || 'El agente falló'); return }
    try {
      const found = parseImprovements(buffer.current.length > (event.text || '').length ? buffer.current : event.text || buffer.current)
      const known = new Set(itemsRef.current.map(item => item.title.toLowerCase())), fresh = found.filter(item => !known.has(item.title.toLowerCase()))
      if (!fresh.length) { setError('El agente no propuso mejoras nuevas'); return }
      persist([...itemsRef.current, ...fresh])
    }
    catch (failure) { setError(failure.message || String(failure)) }
  }), [])

  useEffect(() => () => { const id = runId.current; runId.current = null; if (id) window.gitGraph.agent.cancel(id).catch(() => {}) }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  async function request() {
    if (busy) return
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    runId.current = id; buffer.current = ''; setBusy(true); setError('')
    try { const settings = await window.gitGraph.settings.read(); if (runId.current !== id) return; await window.gitGraph.agent.send(root, { id, prompt: buildRequest(itemsRef.current), mode: 'read', model: settings.improvementsModel || settings.agentModel, effort: settings.agentEffort }) }
    catch (failure) { runId.current = null; setBusy(false); setError(failure.message || String(failure)) }
  }

  const current = items.find(item => item.id === selected)
  const prompt = current ? buildPrompt(project, current, notes) : ''
  function remove(id: string) {
    if (selected === id) setSelected(null)
    persist(items.filter(item => item.id !== id))
  }
  function clearAll() { setSelected(null); persist([]) }
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch (failure) { setError('No se pudo copiar: ' + (failure.message || String(failure))) }
  }

  return <div className="issues-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="issues-page improve-page" role="dialog" aria-modal="true" aria-label="Mejoras con IA">
    <header className="issues-head">
      <h2 className="agent-title"><span className="agent-logo"><Lightbulb size={16}/></span><span>Mejoras</span><em title={root}>{project}</em></h2>
      <div className="issues-tools">
        {items.length > 0 && <button className="tool-button" title="Borrar todas las mejoras guardadas" aria-label="Borrar todas las mejoras guardadas" disabled={busy} onClick={clearAll}><Trash2 size={16}/></button>}
        {items.length > 0 && <button className="tool-button" title="Pedir más mejoras (excluye las guardadas)" aria-label="Pedir más mejoras" disabled={busy} onClick={request}><Plus size={16}/></button>}
        <button className="tool-button" title="Cerrar (Esc)" aria-label="Cerrar" onClick={onClose}><X size={18}/></button>
      </div>
    </header>
    <div className="improve-body">
      {loaded && !items.length && !busy && <div className="agent-empty"><Lightbulb size={30}/><p>Pide a la IA ideas de mejora para este proyecto, elige una y copia el prompt generado.</p><div><button onClick={request}>Pedir mejoras a la IA</button></div></div>}
      {busy && <div className="improve-busy"><LoaderCircle size={16} className="spin"/>{items.length ? 'Buscando mejoras nuevas…' : 'Analizando el proyecto…'}</div>}
      {error && <p className="action-error" role="alert">{error}</p>}
      {items.length > 0 && <div className="improve-grid">
        <ul className="improve-list" role="radiogroup" aria-label="Mejoras propuestas">{items.map((item, index) => <li key={item.id} className="improve-row">
          <button type="button" role="radio" aria-checked={selected === item.id} className={'improve-item' + (selected === item.id ? ' active' : '')} onClick={() => setSelected(item.id)}>
            <b>{item.title}{item.effort && <small>{item.effort}</small>}</b><span>{item.description}</span>
          </button>
          <button type="button" className="improve-delete" title="Eliminar mejora" aria-label={`Eliminar ${item.title}`} disabled={busy} onClick={() => remove(item.id)}><Trash2 size={14}/></button></li>)}</ul>
        <div className="improve-prompt">
          {!current ? <p className="improve-hint">Selecciona una mejora para generar el prompt.</p> : <>
            <label htmlFor="improve-notes">Notas adicionales (opcional)</label>
            <textarea id="improve-notes" rows={3} value={notes} placeholder="Restricciones, preferencias…" onChange={event => setNotes(event.target.value)}/>
            <label htmlFor="improve-output">Prompt generado</label>
            <textarea id="improve-output" className="improve-output" readOnly value={prompt} onFocus={event => event.target.select()}/>
            <button type="button" className="improve-copy" onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? 'Copiado' : 'Copiar prompt'}</button>
          </>}
        </div>
      </div>}
    </div>
  </div></div>
}
