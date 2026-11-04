import React, { useEffect, useRef, useState } from 'react'

const items: ([string, string] | null)[] = [
  ['tag', 'Añadir etiqueta…'], ['branch', 'Crear rama…'], null,
  ['checkout', 'Checkout de este commit…'], ['cherry-pick', 'Cherry-pick…'], ['revert', 'Revertir…'], null,
  ['merge', 'Fusionar en la rama actual…'], ['rebase', 'Rebase de la rama actual sobre este commit…'], ['reset', 'Reset de la rama actual a este commit…'], null,
  ['copy-hash', 'Copiar hash del commit'], ['copy-subject', 'Copiar descripción del commit'],
]
const titles = Object.fromEntries(items.filter((item): item is [string, string] => item !== null))

export function CommitMenu({ menu, onClose, onAction }) {
  const ref = useRef<any>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const outside = event => { if (!ref.current?.contains(event.target)) onClose() }
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); menu.origin?.focus() }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')]
      const current = buttons.indexOf(document.activeElement)
      buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key) }
  }, [menu, onClose])
  return <div ref={ref} className="commit-menu" role="menu" aria-label="Acciones del commit" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 340)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 430)) }}>
    {items.map((item, index) => item ? <button key={item[0]} role="menuitem" onClick={() => onAction(item[0], menu.commit)}>{item[1]}</button> : <div className="commit-menu-divider" role="separator" key={'divider'+index}/>)}
  </div>
}

export function CommitActionDialog({ action, busy, error, onCancel, onRun }) {
  const [name, setName] = useState(''), [message, setMessage] = useState(''), [mode, setMode] = useState('mixed'), [mainline, setMainline] = useState('1'), [acknowledged, setAcknowledged] = useState(false)
  const { type, commit, branch, root } = action
  const naming = type === 'tag' || type === 'branch'
  const mergeCommit = commit.parents.length > 1 && (type === 'cherry-pick' || type === 'revert')
  useEffect(() => {
    const key = event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [busy, onCancel])
  const description = {
    tag: 'Se creará una etiqueta en este commit: anotada si escribes un mensaje, ligera si lo dejas vacío.', branch: 'Se creará una rama en este commit sin cambiar de rama.',
    checkout: 'Se cambiará a este commit con HEAD separado.', 'cherry-pick': 'Se aplicarán los cambios de este commit sobre la rama actual.',
    revert: 'Se creará un nuevo commit que revierte los cambios seleccionados.', merge: 'Se fusionará este commit en la rama actual.',
    rebase: 'Se reproducirán los commits de la rama actual sobre este commit.', reset: 'Se moverá la rama actual a este commit.',
  }[type]
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <form className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-title" onSubmit={event => { event.preventDefault(); onRun({ name, message, mode, mainline: Number(mainline) }) }}>
      <h2 id="action-title">{titles[type]?.replace('…', '')}</h2><p>{description}</p>
      <div className="action-target"><strong>{commit.subject}</strong><code>{commit.hash}</code><span>Repositorio: {root}</span><span>Rama actual: {branch}</span></div>
      {naming && <label className="action-label">Nombre de {type === 'tag' ? 'la etiqueta' : 'la rama'}<input autoFocus required value={name} onChange={event => setName(event.target.value)} placeholder={type === 'tag' ? 'v1.0.0' : 'nombre-de-rama'}/></label>}
      {type === 'tag' && <label className="action-label">Mensaje (opcional)<textarea rows={3} value={message} onChange={event => setMessage(event.target.value)} placeholder="Deja vacío para una etiqueta ligera"/></label>}
      {mergeCommit && <label className="action-label">Padre principal<select value={mainline} onChange={event => setMainline(event.target.value)}>{commit.parents.map((parent, index) => <option key={parent} value={index + 1}>Padre {index + 1} · {parent.slice(0, 10)}</option>)}</select><small>Git comparará el merge con el padre elegido.</small></label>}
      {type === 'reset' && <><label className="action-label">Modo de reset<select value={mode} onChange={event => { setMode(event.target.value); setAcknowledged(false) }}><option value="soft">Soft · conserva índice y archivos</option><option value="mixed">Mixed · conserva archivos, reinicia el índice</option><option value="hard">Hard · descarta cambios en archivos e índice</option></select></label>{mode === 'hard' && <label className="action-warning"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/> Entiendo que se descartarán los cambios rastreados del índice y del directorio de trabajo. También pueden eliminarse archivos sin seguimiento que impidan escribir los archivos del commit.</label>}</>}
      {type === 'rebase' && <p className="action-notice">Rebase reescribe los commits de la rama actual. Si aparecen conflictos, Git dejará la operación en curso para resolverlos.</p>}
      {['merge', 'cherry-pick', 'revert'].includes(type) && <p className="action-notice">Si aparecen conflictos, Git dejará la operación en curso para que puedas resolverlos.</p>}
      {error && <div className="action-error" role="alert">{error}</div>}
      <div className="action-buttons"><button type="button" autoFocus={!naming} disabled={busy} onClick={onCancel}>Cancelar</button><button className={mode === 'hard' && type === 'reset' ? 'danger' : 'confirm'} type="submit" disabled={busy || (naming && !name.trim()) || (type === 'reset' && mode === 'hard' && !acknowledged)}>{busy ? 'Ejecutando…' : 'Confirmar'}</button></div>
    </form>
  </div>
}
