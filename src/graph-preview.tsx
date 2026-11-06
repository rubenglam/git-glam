import React, { useState } from 'react'
import { GitBranch, Cloud, ChevronDown, ChevronRight } from 'lucide-react'
import { graphSegments } from './graph-segments.ts'

interface PreviewRow {
  col: number
  hasIncoming: boolean
  before: (string | null)[]
  after: (string | null)[]
  joins: number[]
  forks: number[]
  message: string
  merge?: boolean
  head?: boolean
  refs?: { name: string; remote?: boolean }[]
}

// Miniature of a real-looking history: overlapping feature branches that open and close at different
// moments, a branch merged while others stay open, and ten lanes so every palette colour shows up.
type RowSpec = Partial<PreviewRow> & { col: number; message: string }
const SPECS: RowSpec[] = [
  { col: 0, head: true, message: 'docs: add decisions log', refs: [{ name: 'fix/align' }, { name: 'dev', remote: true }] },
  { col: 0, forks: [1], merge: true, message: 'Merge pull request #238 from feat/compare' },
  { col: 1, forks: [2], message: 'test: cover compare SQL against real data', refs: [{ name: 'feat/compare', remote: true }] },
  { col: 2, message: 'fix: update LIKE escape handling', refs: [{ name: 'fix/escape' }] },
  { col: 0, joins: [1], forks: [1], merge: true, message: 'Merge pull request #237 from feat/holders' },
  { col: 1, forks: [3], message: 'perf: make CUSIP filter sargable', refs: [{ name: 'feat/holders', remote: true }] },
  { col: 3, forks: [4], message: 'feat: add get_portfolio tool', refs: [{ name: 'feat/portfolio' }] },
  { col: 0, joins: [2], merge: true, message: 'Merge pull request #236 from fix/escape' },
  { col: 4, forks: [5], message: 'feat: add list_filings tool', refs: [{ name: 'feat/filings', remote: true }] },
  { col: 5, forks: [6], message: 'refactor: typed read repositories' },
  { col: 6, forks: [7], message: 'chore: bump dependencies', refs: [{ name: 'chore/deps' }] },
  { col: 7, forks: [8], message: 'ci: cache build artifacts', refs: [{ name: 'ci/cache', remote: true }] },
  { col: 8, forks: [9], message: 'docs: update README', refs: [{ name: 'docs/readme' }] },
  { col: 9, message: 'docs: describe settings' },
  { col: 8, joins: [9], merge: true, message: 'Merge pull request #243 from docs/readme' },
  { col: 7, joins: [8], merge: true, message: 'Merge pull request #242 from ci/cache' },
  { col: 6, joins: [7], merge: true, message: 'Merge pull request #241 from chore/deps' },
  { col: 5, joins: [6], merge: true, message: 'Merge pull request #235 from feat/filings' },
  { col: 0, joins: [1], merge: true, message: 'Merge pull request #234 from feat/holders' },
  { col: 0, joins: [3, 4, 5], merge: true, message: 'Merge pull request #233 from feat/portfolio' },
  { col: 0, message: 'init: project scaffold' },
]

// Derive lane state per row so only the structure above needs to be maintained.
const LANES = 10
const ROWS: PreviewRow[] = (() => {
  let lanes: (string | null)[] = []
  let id = 0
  return SPECS.map((spec, index) => {
    const before = [...lanes]
    const after = [...lanes]
    for (const lane of spec.joins ?? []) after[lane] = null
    for (const lane of spec.forks ?? []) after[lane] = 'l' + id++
    after[spec.col] = index === SPECS.length - 1 ? null : 'l' + id++
    lanes = after
    return { hasIncoming: index > 0, joins: [], forks: [], ...spec, before, after }
  })
})()

const HEIGHT = 28
const x = (lane: number) => 17 + lane * 18

const STORAGE_KEY = 'graph-preview-open'

export function GraphPreview({ colors }: { colors: string[] }) {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) !== '0')
  const toggle = () => setOpen(value => { localStorage.setItem(STORAGE_KEY, value ? '0' : '1'); return !value })
  const color = (lane: number) => colors[lane % colors.length]
  return <div className="graph-preview-wrap">
    <button type="button" className="graph-preview-toggle" aria-expanded={open} aria-controls="graph-preview" onClick={toggle}>{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}{open ? 'Ocultar vista previa' : 'Mostrar vista previa'}</button>
    {open && <div id="graph-preview" className="graph-preview" aria-label="Vista previa del grafo con la paleta elegida" role="img">
    {ROWS.map((row, index) => <div key={index} className={'graph-preview-row' + (row.merge ? ' merge' : '') + (row.head ? ' head' : '')}>
      <svg width={17 + LANES * 18} height={HEIGHT} aria-hidden="true">
        {graphSegments(row, HEIGHT).map((segment, i) => <path key={i} d={segment.d} stroke={color(segment.lane)}/>)}
        {row.head && <circle cx={x(row.col)} cy={HEIGHT / 2} r="9" fill="none" stroke={color(row.col)} strokeWidth="2"/>}
        <circle cx={x(row.col)} cy={HEIGHT / 2} r={row.head ? 5 : 3.5} fill={row.head ? 'var(--graph-background)' : color(row.col)} stroke={color(row.col)} strokeWidth="2"/>
      </svg>
      <div className="graph-preview-content">
        {row.head && <span className="graph-preview-head">HEAD</span>}
        {row.refs?.map(ref => <span key={ref.name} className="ref"><span className="ref-icon" style={{ background: color(row.col) }}><GitBranch size={11}/></span><span className="ref-name">{ref.name}</span>{ref.remote && <span className="ref-remote"><Cloud size={11}/><i>origin</i></span>}</span>)}
        <span className="graph-preview-message">{row.message}</span>
      </div>
    </div>)}
  </div>}
  </div>
}
