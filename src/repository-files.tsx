import React, { useEffect, useState } from 'react'
import { FileIcon } from './file-icon.tsx'
import { ChevronDown, ChevronRight, Folder, Search, X } from 'lucide-react'

type Entry = { name: string, path: string, directory: boolean }

export function RepositoryFiles({ root, searchOpen, onCloseSearch, selectedPath, onSelectFile }: { root: string, searchOpen: boolean, onCloseSearch: () => void, selectedPath?: string, onSelectFile: (path: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ files: Entry[], truncated: boolean } | null>(null)
  const [searchError, setSearchError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [folders, setFolders] = useState<Record<string, Entry[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = (path: string) => {
    setErrors(current => { const next = { ...current }; delete next[path]; return next })
    window.gitGraph.browseFiles(root, path).then((entries: Entry[]) => setFolders(current => ({ ...current, [path]: entries })))
      .catch((error: Error) => setErrors(current => ({ ...current, [path]: error.message || String(error) })))
  }
  useEffect(() => { load('') }, [root])
  useEffect(() => {
    if (!searchOpen || !query.trim()) { setResults(null); setSearchError(''); return }
    let cancelled = false
    setResults(null); setSearchError('')
    const timer = window.setTimeout(() => {
      window.gitGraph.searchFiles(root, query.trim()).then(result => { if (!cancelled) setResults(result) })
        .catch(error => { if (!cancelled) setSearchError(error.message || String(error)) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [root, query, searchOpen])
  const renderFolder = (path: string, depth: number): React.ReactNode => <>
    {errors[path] && <p className="panel-empty">{errors[path]} <button onClick={() => load(path)}>Reintentar</button></p>}
    {!folders[path] && !errors[path] && <p className="panel-empty">Cargando…</p>}
    {folders[path]?.length === 0 && <p className="panel-empty">Carpeta vacía.</p>}
    {folders[path]?.map(entry => <React.Fragment key={entry.path}>
      <button className={'side-row repository-file-row' + (!entry.directory && selectedPath === entry.path ? ' active' : '')} style={{ paddingLeft: 8 + depth * 14 }} title={entry.path} aria-expanded={entry.directory ? Boolean(expanded[entry.path]) : undefined} onClick={() => {
        if (!entry.directory) return onSelectFile(entry.path)
        const next = !expanded[entry.path]
        setExpanded(current => ({ ...current, [entry.path]: next }))
        if (next && !folders[entry.path]) load(entry.path)
      }}>
        {Array.from({ length: depth }, (_, level) => <i key={level} className="repository-tree-guide" style={{ left: 15 + level * 14 }} aria-hidden="true"/>)}
        {entry.directory ? <>{expanded[entry.path] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<Folder size={15}/></> : <><i className="repository-file-indent"/><FileIcon path={entry.path} size={15}/></>}
        <span>{entry.name}</span>
      </button>
      {entry.directory && expanded[entry.path] && renderFolder(entry.path, depth + 1)}
    </React.Fragment>)}
  </>
  return <>
    {searchOpen && <div className="explorer-search repository-search"><Search size={13}/><input autoFocus value={query} placeholder="Buscar archivos por ruta…" aria-label="Buscar archivos" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); onCloseSearch() } }}/><button title="Cerrar búsqueda" aria-label="Cerrar búsqueda" onClick={() => { setQuery(''); onCloseSearch() }}><X size={13}/></button></div>}
    {searchOpen && query.trim() ? <div className="panel-items">
      {searchError ? <p className="panel-empty">{searchError}</p> : !results ? <p className="panel-empty">Buscando…</p> : <>
        {results.files.map(file => <button key={file.path} className={'side-row repository-search-result' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelectFile(file.path)}><FileIcon path={file.path} size={15}/><span>{file.path}</span></button>)}
        {!results.files.length && <p className="panel-empty">No se encontraron archivos.</p>}
        {results.truncated && <p className="panel-empty">La búsqueda alcanzó el límite de resultados o archivos examinados. Prueba con una ruta más concreta.</p>}
      </>}
    </div> : <div className="panel-items">{renderFolder('', 0)}</div>}

  </>
}
