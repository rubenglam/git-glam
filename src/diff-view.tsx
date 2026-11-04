import React, { useMemo } from 'react'
import { parseDiff } from './diff-parse.ts'
import type { DiffState, HunkAction, ParsedDiffFile } from './types.ts'

const splitPath = (path: string) => { const index = path.lastIndexOf('/'); return index < 0 ? ['', path] : [path.slice(0, index + 1), path.slice(index + 1)] }

const DiffFile = React.memo(function DiffFile({ file, single, hunkAction }: { file: ParsedDiffFile; single: boolean; hunkAction?: HunkAction | HunkAction[] }) {
  const [dir, name] = splitPath(file.path)
  return <section className="df">
    {!single && <header className="df-head"><span className="df-path"><span>{dir}</span><strong>{name}</strong></span>{file.notes.map(note => <em key={note}>{note}</em>)}<span className="tree-stats"><b className="plus">+{file.added}</b><b className="minus">−{file.deleted}</b></span></header>}
    {single && file.notes.length > 0 && <div className="df-notes">{file.notes.join(' · ')}</div>}
    {!single && !file.lines.length && <div className="df-empty">{file.notes.length ? '' : 'Sin cambios de contenido.'}</div>}
    {file.lines.map((line, index) => line.type === 'hunk'
      ? <div className="dl dl-hunk" key={index}><span className="dl-no"/><span className="dl-no"/><span className="dl-sign">@@</span><span className="dl-text">{line.text}</span>{([] as HunkAction[]).concat(hunkAction || []).map(action => <button key={action.label} className={'hunk-button' + (action.danger ? ' danger' : '')} title={action.title} disabled={action.disabled} onClick={() => action.run(file, line)}>{action.icon}{action.label}</button>)}</div>
      : <div className={'dl dl-' + line.type} key={index}><span className="dl-no">{line.oldNo ?? ''}</span><span className="dl-no">{line.newNo ?? ''}</span><span className="dl-sign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}</span><span className="dl-text">{line.text}</span></div>)}
  </section>
})

export function DiffView({ diff, path, label = 'Cambios del commit', empty = 'Este commit no contiene cambios.', hunkAction }: { diff: DiffState; path?: string | null; label?: string; empty?: string; hunkAction?: HunkAction | HunkAction[] }) {
  const files = useMemo(() => parseDiff(diff.text), [diff.text])
  const shown = path ? files.filter(file => file.path === path) : files
  return <div className="diff-view" tabIndex={0} aria-label={label}>
    {diff.loading ? <p className="panel-empty">Cargando cambios…</p> : diff.error ? <p className="panel-empty">{diff.error}</p> : shown.length ? <div className="diff-body">{shown.map(file => <DiffFile key={file.path} file={file} single={Boolean(path)} hunkAction={hunkAction}/>)}</div> : <p className="panel-empty">{path ? 'No hay diff de texto para este archivo.' : empty}</p>}
  </div>
}
