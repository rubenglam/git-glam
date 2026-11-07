import React, { useEffect, useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'

const folders = ['.agents', '.claude', '.skills', '.github']
export function DocumentationFilter({ value, onChange, disabled }: { value: string[], onChange: (value: string[]) => void, disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', away); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key) }
  }, [open])
  return <span className="documentation-filter" ref={box}><button className={'tool-button' + (value.length ? ' documentation-filter-active' : '')} title="Opciones de filtro" aria-label="Opciones de filtro de documentación" aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(!open)}><ListFilter size={15}/></button>
    {open && <div className="documentation-filter-popover" role="dialog" aria-label="Opciones de filtro de documentación"><strong>Mostrar carpetas</strong>{folders.map(folder => <label key={folder}><input type="checkbox" checked={value.includes(folder)} onChange={event => onChange(event.target.checked ? [...value, folder] : value.filter(item => item !== folder))}/>{folder}</label>)}</div>}
  </span>
}
