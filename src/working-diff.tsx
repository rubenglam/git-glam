import React, { useEffect, useState } from 'react'
import { Minus, Plus, Undo2, X } from 'lucide-react'
import { DiffView } from './diff-view.tsx'
import type { DiffState } from './types.ts'

// Diff of one pending file, with per-hunk stage/unstage. `version` changes whenever the repository is reloaded.
export function WorkingDiff({ root, change, version, busy, onHunk, onDiscardHunk, onClose }) {
  const { path, staged, untracked } = change
  const [diff, setDiff] = useState<DiffState>({ text: '', loading: true })
  useEffect(() => {
    let active = true
    setDiff(old => ({ text: old.text, loading: !old.text }))
    window.gitGraph.workingDiff(root, { path, staged }).then(text => { if (active) setDiff({ text }) }).catch(e => { if (active) setDiff({ text: '', error: e.message || String(e) }) })
    return () => { active = false }
  }, [root, path, staged, version])
  const request = line => ({ path, staged, index: line.index, header: line.header })
  const hunkAction = untracked ? undefined : [{
    label: staged ? 'Quitar bloque' : 'Preparar bloque', title: staged ? 'Quitar este bloque del área de preparación' : 'Preparar solo este bloque',
    icon: staged ? <Minus size={13}/> : <Plus size={13}/>, disabled: busy, run: (_file, line) => onHunk(request(line)),
  }, ...(staged ? [] : [{
    label: 'Descartar', danger: true, title: 'Descartar este bloque de los cambios sin preparar',
    icon: <Undo2 size={13}/>, disabled: busy, run: (_file, line) => onDiscardHunk(request(line)),
  }])]
  return <section className="details working-diff" aria-label="Cambios del archivo">
    <header className="wd-head"><span className="wd-path" title={path}>{path}</span><em className={staged ? 'wd-staged' : ''}>{staged ? 'Preparado' : untracked ? 'Nuevo, sin seguimiento' : 'Sin preparar'}</em><button className="tool-button" title="Cerrar" aria-label="Cerrar diff" onClick={onClose}><X size={16}/></button></header>
    <DiffView diff={diff} path={path} label="Cambios del archivo" empty="No hay diff de texto para este archivo." hunkAction={hunkAction}/>
  </section>
}
