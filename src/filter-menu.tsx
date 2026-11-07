import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

let openMenus = 0
// The dialog asks this before treating Escape as "close", so Escape only closes an open filter menu first.
export const isFilterMenuOpen = () => openMenus > 0

// GitHub-style filter dropdown. `options`: [{ value, label, color? }]; `free` lets the user type a value that is not listed.
export function FilterMenu({ label, value, options, onChange, searchable = false, free = false, defaultValue = '' }) {
  const [open, setOpen] = useState(false), [text, setText] = useState('')
  const box = useRef<any>(null)
  useEffect(() => {
    if (!open) return
    openMenus++
    const away = event => { if (!box.current?.contains(event.target)) setOpen(false) }
    const key = event => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', away); window.addEventListener('keydown', key)
    return () => { openMenus--; window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key) }
  }, [open])
  const shown = options.find(option => option.value === value)?.label ?? value
  const active = Boolean(value) && value !== defaultValue
  const needle = text.trim().toLowerCase()
  const visible = useMemo(() => needle ? options.filter(option => option.label.toLowerCase().includes(needle)) : options, [options, needle])
  const pick = next => { onChange(next); setOpen(false); setText('') }
  const typed = free && text.trim() && !options.some(option => option.value.toLowerCase() === needle)
  return <div className="filter-menu" ref={box}>
    <button type="button" className={'filter-button ' + (active ? 'active' : '')} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{label}{shown && (active || defaultValue) ? <b>{shown}</b> : null}<ChevronDown size={13}/></button>
    {open && <div className="filter-popover" role="listbox" aria-label={label}>
      {(searchable || free) && <input aria-label={`Buscar ${label.toLowerCase()}`} className="filter-search" autoFocus value={text} placeholder={free ? `Buscar o escribir ${label.toLowerCase()}…` : `Buscar ${label.toLowerCase()}…`} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (typed) pick(text.trim()); else if (visible.length === 1) pick(visible[0].value) } }}/>}
      <div className="filter-options">
        {value && value !== defaultValue && <button type="button" className="filter-clear" onClick={() => pick(defaultValue)}>{defaultValue ? 'Restablecer' : 'Quitar filtro'}</button>}
        {typed && <button type="button" onClick={() => pick(text.trim())}>Usar «{text.trim()}»</button>}
        {visible.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => pick(option.value)}><span className="filter-check">{option.value === value && <Check size={13}/>}</span>{option.color && <i className="filter-dot" style={{ background: '#' + option.color }}/>}<span className="filter-label">{option.label}</span></button>)}
        {!visible.length && !typed && <p>Sin resultados</p>}
      </div>
    </div>}
  </div>
}
