import React, { useEffect, useRef, useState } from 'react'
import type { FormChoice, FormField, MenuItem } from '../types.ts'

function useEscape(busy: boolean, onCancel: () => void) {
  useEffect(() => {
    const key = event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [busy, onCancel])
}

// Shared shell: runs `task`, keeps the dialog open and shows the error when it fails.
function Shell({ title, description, danger, confirmLabel, canSubmit = true, task, onCancel, onDone, children }: { title: string; description?: React.ReactNode; danger?: boolean; confirmLabel: string; canSubmit?: boolean; task: () => Promise<unknown> | unknown; onCancel: () => void; onDone: () => void; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEscape(busy, onCancel)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !canSubmit) return
    setBusy(true); setError('')
    try { await task(); onDone() } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <form className="action-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
      {error && <div className="action-error" role="alert">{error}</div>}
      <div className="action-buttons"><button type="button" autoFocus={Boolean(danger)} disabled={busy} onClick={onCancel}>Cancelar</button><button className={danger ? 'danger' : 'confirm'} type="submit" disabled={busy || !canSubmit}>{busy ? 'Ejecutando…' : confirmLabel}</button></div>
    </form>
  </div>
}

export function ConfirmDialog({ title, description, details, confirmLabel = 'Confirmar', danger = true, onConfirm, onCancel, onDone }: { title: string; description?: React.ReactNode; details?: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown> | unknown; onCancel: () => void; onDone: () => void }) {
  return <Shell title={title} description={description} danger={danger} confirmLabel={confirmLabel} task={onConfirm} onCancel={onCancel} onDone={onDone}>
    {details && <div className="action-target">{details}</div>}
  </Shell>
}

// `fields`: [{ key, label, initial, placeholder, multiline }] text inputs; `checks`: [{ key, label, initial }] checkboxes;
// `choices`: [{ key, label, options: [[value, text]], initial }] selects.
export function FormDialog({ title, description, fields = [], checks = [], choices = [], confirmLabel = 'Aceptar', required = [], onSubmit, onCancel, onDone }: { title: string; description?: React.ReactNode; fields?: FormField[]; checks?: FormField[]; choices?: FormChoice[]; confirmLabel?: string; required?: string[]; onSubmit: (values: Record<string, any>) => Promise<unknown> | unknown; onCancel: () => void; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries([...fields, ...checks, ...choices].map(item => [item.key, item.initial ?? (checks.includes(item) ? false : '')])))
  const set = (key: string, value: unknown) => setValues(old => ({ ...old, [key]: value }))
  const first = useRef<any>(null)
  useEffect(() => { first.current?.select?.() }, [])
  const ready = required.every(key => String(values[key] ?? '').trim())
  return <Shell title={title} description={description} confirmLabel={confirmLabel} canSubmit={ready} task={() => onSubmit(values)} onCancel={onCancel} onDone={onDone}>
    {fields.map((field, index) => <label className="action-label" key={field.key}>{field.label}
      {field.multiline ? <textarea rows={3} value={values[field.key]} placeholder={field.placeholder} onChange={event => set(field.key, event.target.value)}/>
        : <input ref={index === 0 ? first : undefined} autoFocus={index === 0} value={values[field.key]} placeholder={field.placeholder} onChange={event => set(field.key, event.target.value)}/>}
    </label>)}
    {choices.map(choice => <label className="action-label" key={choice.key}>{choice.label}
      <select value={values[choice.key]} onChange={event => set(choice.key, event.target.value)}>{choice.options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
    </label>)}
    {checks.map(check => <label className="action-check" key={check.key}><input type="checkbox" checked={values[check.key]} onChange={event => set(check.key, event.target.checked)}/> {check.label}</label>)}
  </Shell>
}

// items: [{ label, run, danger, disabled } | null (separator)]
export function ContextMenu({ x, y, items, label = 'Acciones', onClose }: { x: number; y: number; items: (MenuItem | null)[]; label?: string; onClose: () => void }) {
  const ref = useRef<any>(null)
  useEffect(() => {
    ref.current?.querySelector('button:not(:disabled)')?.focus()
    const outside = event => { if (!ref.current?.contains(event.target)) onClose() }
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')], current = buttons.indexOf(document.activeElement)
      buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key) }
  }, [onClose])
  return <div ref={ref} className="commit-menu" role="menu" aria-label={label} style={{ left: Math.max(4, Math.min(x, window.innerWidth - 300)), top: Math.max(4, Math.min(y, window.innerHeight - 40 * items.length - 16)) }}>
    {items.map((item, index) => item ? <button key={item.label} role="menuitem" className={item.danger ? 'menu-danger' : undefined} disabled={item.disabled} onClick={() => { onClose(); item.run() }}>{item.label}</button> : <div className="commit-menu-divider" role="separator" key={'divider' + index}/>)}
  </div>
}
