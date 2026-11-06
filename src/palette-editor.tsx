import React, { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'

export const CUSTOM_MIN = 2
export const CUSTOM_MAX = 24
export const NAME_MAX = 32

const PRESET_LABELS: Record<string, string> = { classic: 'Clásica', ocean: 'Océano', forest: 'Bosque', sunset: 'Atardecer', pastel: 'Pastel' }

export interface CustomPalette {
  preset: string
  custom: string[]
  name?: string
}

const HEX = /^#?([0-9a-f]{6})$/i

// Evenly spread hues (golden angle) so each new colour is visibly different from the previous ones.
function nextColor(existing: string[]): string {
  const hue = (existing.length * 137.508 + 200) % 360
  const s = 0.75
  const l = 0.55
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

interface ColorRowProps {
  index: number
  value: string
  canRemove: boolean
  onChange: (value: string) => void
  onRemove: () => void
}

function ColorRow({ index, value, canRemove, onChange, onRemove }: ColorRowProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const valid = HEX.test(draft.trim())
  return <div className="palette-color">
    <span className="palette-color-index">{index + 1}</span>
    <label className="palette-color-swatch" style={{ background: value }}>
      <input type="color" aria-label={`Color de rama ${index + 1}`} value={value} onChange={event => onChange(event.target.value.toLowerCase())}/>
    </label>
    <input className={'palette-color-hex' + (valid ? '' : ' invalid')} type="text" spellCheck={false} maxLength={7} aria-label={`Código hexadecimal del color ${index + 1}`} aria-invalid={!valid} value={draft}
      onChange={event => {
        setDraft(event.target.value)
        const match = HEX.exec(event.target.value.trim())
        if (match) onChange('#' + match[1].toLowerCase())
      }}
      onBlur={() => setDraft(value)}/>
    <button type="button" className="palette-color-remove" title="Quitar color" aria-label={`Quitar color ${index + 1}`} disabled={!canRemove} onClick={onRemove}><X size={12}/></button>
  </div>
}

interface PaletteEditorProps {
  palette: CustomPalette
  presets: Record<string, string[]>
  onChange: (palette: CustomPalette) => void
}

export function PaletteEditor({ palette, presets, onChange }: PaletteEditorProps) {
  const [name, setName] = useState(palette.name || '')
  useEffect(() => setName(palette.name || ''), [palette.name])
  const colors = palette.custom
  const setColors = (custom: string[]) => onChange({ ...palette, custom })
  const commitName = () => {
    const value = name.trim().slice(0, NAME_MAX)
    setName(value)
    if (value !== (palette.name || '')) onChange({ ...palette, name: value })
  }
  return <div className="palette-editor">
    <div className="palette-editor-head">
      <label className="palette-editor-name">Nombre
        <input type="text" maxLength={NAME_MAX} placeholder="Mi paleta" value={name} onChange={event => setName(event.target.value)} onBlur={commitName} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
      </label>
      <label className="palette-editor-copy">Partir de
        <select value="" onChange={event => { if (event.target.value) setColors([...presets[event.target.value]]) }}>
          <option value="">Elegir paleta…</option>
          {Object.keys(presets).map(key => <option key={key} value={key}>{PRESET_LABELS[key] || key}</option>)}
        </select>
      </label>
    </div>
    <div className="palette-color-grid">
      {colors.map((value, index) => <ColorRow key={index} index={index} value={value} canRemove={colors.length > CUSTOM_MIN} onChange={next => setColors(colors.map((c, i) => i === index ? next : c))} onRemove={() => setColors(colors.filter((_, i) => i !== index))}/>)}
      <button type="button" className="palette-color-add" disabled={colors.length >= CUSTOM_MAX} onClick={() => setColors([...colors, nextColor(colors)])}><Plus size={14}/>Añadir color</button>
    </div>
    <small className="palette-editor-hint">{colors.length} de {CUSTOM_MAX} colores · cada rama del grafo usa uno en orden y vuelve a empezar al terminar.</small>
  </div>
}
