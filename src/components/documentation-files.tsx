import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, Search } from 'lucide-react'
import { buildFileTree } from '../lib/file-tree.ts'

type Result = { files: { path: string }[], truncated: boolean }
type DocNode = { type: 'dir', label: string, children: DocNode[] } | { type: 'file', path: string, name: string }
export function DocumentationFiles({ root, selectedPath, onSelect, includeFolders, ai = false }: { ai?: boolean, root: string, selectedPath?: string, onSelect: (path: string) => void, includeFolders: string[] }) {
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let live = true
    setResult(null); setError('');
    (ai ? window.gitGraph.aiFiles(root) : window.gitGraph.documentationFiles(root, includeFolders)).then(value => { if (live) setResult(value) }).catch(e => { if (live) setError(e.message || String(e)) })
    return () => { live = false }
  }, [root, includeFolders, ai])
  const searching = Boolean(query.trim())
  const files = result?.files.filter(file => file.path.toLowerCase().includes(query.trim().toLowerCase())) || []
  const tree = useMemo(() => buildFileTree(files) as DocNode[], [result, query])
  const renderNodes = (nodes: DocNode[], parent: string, depth: number): React.ReactNode => nodes.map(node => {
    if (node.type === 'file') return <button key={node.path} className={'side-row repository-file-row' + (selectedPath === node.path ? ' active' : '')} style={{ paddingLeft: 8 + depth * 14 }} title={node.path} onClick={() => onSelect(node.path)}><i className="repository-file-indent"/><FileText size={15}/><span>{node.name}</span></button>
    const path = [parent, node.label.replaceAll(' / ', '/')].filter(Boolean).join('/')
    const open = searching || Boolean(expanded[path])
    return <React.Fragment key={path}><button className="side-row repository-file-row" style={{ paddingLeft: 8 + depth * 14 }} title={path} aria-expanded={open} onClick={() => setExpanded(current => ({ ...current, [path]: !current[path] }))}>{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<Folder size={15}/><span>{node.label}</span></button>{open && renderNodes(node.children, path, depth + 1)}</React.Fragment>
  })
  return <><div className="explorer-search repository-search"><Search size={13}/><input value={query} placeholder="Buscar documentación…" aria-label="Buscar documentación" onChange={event => setQuery(event.target.value)}/></div><div className="panel-items">
    {error ? <p className="panel-empty" role="alert">{error}</p> : !result ? <p className="panel-empty">Buscando documentación…</p> : <>{renderNodes(tree, '', 0)}{!files.length && <p className="panel-empty">No se encontró documentación{query ? ' para esta búsqueda' : ''}.</p>}{result.truncated && <p className="panel-empty">Se alcanzó el límite de archivos examinados o resultados.</p>}</>}
  </div></>
}

