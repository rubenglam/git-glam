import React, { useEffect, useRef, useState } from 'react'
import { History, X } from 'lucide-react'
import { FileIcon } from './file-icon.tsx'

export function FileMenu({ menu, onClose, onHistory }) {
  const ref = useRef<any>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const outside = event => { if (!ref.current?.contains(event.target)) onClose() }
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key) }
  }, [onClose])
  return <div ref={ref} className="commit-menu file-menu" role="menu" aria-label="Acciones del archivo" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 240)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 60)) }}>
    <button role="menuitem" onClick={() => onHistory(menu.path, menu.rev)}>Historial del archivo</button>
  </div>
}

// Log (--follow) of the file on the left; blame of the file as of the selected commit on the right.
export function FileHistoryDialog({ root, path, rev, formatDate, onClose }) {
  const [entries, setEntries] = useState<any>(null), [error, setError] = useState(''), [selected, setSelected] = useState<any>(null)
  const [blame, setBlame] = useState<any>(null), [blameError, setBlameError] = useState('')
  useEffect(() => {
    const key = event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  useEffect(() => {
    let active = true
    window.gitGraph.fileHistory(root, path, rev).then(list => { if (!active) return; setEntries(list); setSelected(list[0]?.hash ?? null) }).catch(e => { if (active) { setEntries([]); setError(e.message || String(e)) } })
    return () => { active = false }
  }, [root, path, rev])
  const entry = entries?.find(item => item.hash === selected)
  useEffect(() => {
    if (!entry) return
    let active = true
    setBlame(null); setBlameError('')
    window.gitGraph.fileBlame(root, entry.path, entry.hash).then(lines => { if (active) setBlame(lines) }).catch(e => { if (active) setBlameError(e.message || String(e)) })
    return () => { active = false }
  }, [root, entry])
  const name = path.split('/').pop()
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="action-dialog file-history" role="dialog" aria-modal="true" aria-labelledby="file-history-title">
      <header className="fh-head"><FileIcon path={path} size={16}/><h2 id="file-history-title" title={path}>Historial: {name}</h2><span className="fh-path">{path}</span><button className="tool-button" aria-label="Cerrar" title="Cerrar" onClick={onClose}><X size={17}/></button></header>
      <div className="fh-body">
        <div className="fh-log" role="listbox" aria-label="Commits que modifican el archivo">
          {entries === null ? <p className="panel-empty">Cargando historial…</p> : error ? <p className="panel-empty">{error}</p> : !entries.length ? <p className="panel-empty">Este archivo no tiene historial.</p> : entries.map(item => <button key={item.hash} role="option" aria-selected={item.hash === selected} className={'fh-entry' + (item.hash === selected ? ' active' : '')} onClick={() => setSelected(item.hash)}>
            <strong>{item.subject}</strong>
            <small>{item.author} · {formatDate(item.date)} · <code>{item.hash.slice(0, 8)}</code></small>
            {item.path !== path && <small className="fh-renamed"><History size={11}/> {item.path}</small>}
          </button>)}
        </div>
        <div className="fh-blame" aria-label="Blame">
          {!entry ? null : blameError ? <p className="panel-empty">{blameError}</p> : blame === null ? <p className="panel-empty">Calculando blame…</p> : <table><tbody>{blame.map((line, index) => {
            const first = index === 0 || blame[index - 1].hash !== line.hash
            return <tr key={line.line} className={line.hash === selected ? 'fh-current' : undefined}>
              <td className="fh-meta" title={first ? `${line.summary}\n${line.hash}` : undefined}>{first && <><button className="cd-link" disabled={!entries.some(item => item.hash === line.hash)} onClick={() => setSelected(line.hash)}>{line.hash.slice(0, 8)}</button><span>{line.author}</span><span>{line.time ? formatDate(line.time) : ''}</span></>}</td>
              <td className="fh-no">{line.line}</td>
              <td className="fh-code"><pre>{line.text || ' '}</pre></td>
            </tr>
          })}</tbody></table>}
        </div>
      </div>
    </div>
  </div>
}
