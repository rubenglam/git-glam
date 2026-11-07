import { useRef } from 'react'

export const PANEL_MIN = 160

export function PanelSeparator({ side, panel, order, width, maxWidth, onResize }) {
  const drag = useRef<any>(null)
  const direction = side === 'left' ? 1 : -1
  const finishDrag = event => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="panel-separator" style={{ order }} role="separator" tabIndex={0} aria-controls={panel === 'branches' ? 'branches-panel' : 'changes-panel'} aria-label={panel === 'branches' ? 'Ajustar ancho del panel de ramas' : 'Ajustar ancho del panel de cambios'} aria-orientation="vertical" aria-valuemin={PANEL_MIN} aria-valuemax={maxWidth} aria-valuenow={width} onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + direction * (event.clientX - drag.current.x))
  }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null }} onKeyDown={event => {
    let value
    if (event.key === 'ArrowLeft') value = width - 10 * direction
    else if (event.key === 'ArrowRight') value = width + 10 * direction
    else if (event.key === 'Home') value = PANEL_MIN
    else if (event.key === 'End') value = maxWidth
    else return
    event.preventDefault()
    onResize(value)
  }}/>
}

export function ColumnResize({ label, width, direction, onResize, onReset }) {
  const drag = useRef<{ x: number, width: number, pointerId: number } | null>(null)
  return <div className="column-resize" role="separator" tabIndex={0} aria-label={`Redimensionar ${label}`} aria-orientation="vertical" aria-valuemin={50} aria-valuemax={600} aria-valuenow={Math.round(width)} title="Arrastra para redimensionar" onDoubleClick={onReset} onPointerDown={event => { event.preventDefault(); drag.current = { x: event.clientX, width, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) onResize(drag.current.width + direction * (event.clientX - drag.current.x)) }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); onResize(width + (event.key === 'ArrowRight' ? 10 : -10) * direction) }}/>
}
