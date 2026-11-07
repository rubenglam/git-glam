import React, { useEffect, useRef, useState } from 'react'
import { GitBranch, Cloud, LoaderCircle, Tag } from 'lucide-react'
import { graphSegments } from '../lib/graph-segments.ts'
import { color, date } from '../lib/format.ts'
import type { GraphRow } from '../types.ts'

function Graph({ row, head, rowHeight, palette }) {
  const x = i => 17 + i * 18
  return <svg className="graph" width="100%" height={rowHeight} aria-hidden="true">
    {graphSegments(row, rowHeight).map((segment, index) => <path key={index} d={segment.d} stroke={color(segment.lane, palette)} />)}
    {head && <circle className="head-halo" cx={x(row.col)} cy={rowHeight / 2} r="9" fill="none" stroke={color(row.col, palette)} strokeWidth="2" />}
    <circle cx={x(row.col)} cy={rowHeight / 2} r={head ? 5 : 3.5} fill={head ? 'var(--graph-background)' : color(row.col, palette)} stroke={color(row.col, palette)} strokeWidth="2" />
  </svg>
}

function RefLabel({ name, lane, synced, onContext, onOpen, palette }) {
  const tag = name.startsWith('tag: ')
  const label = name.replace(/^HEAD -> /, '').replace(/^tag: /, '')
  return <span className="ref" onClick={tag || !onOpen ? undefined : event => { event.stopPropagation(); if (event.detail >= 2) { event.preventDefault(); onOpen(name.replace(/^HEAD -> /, '')) } }} onContextMenu={!onContext ? undefined : event => { event.preventDefault(); event.stopPropagation(); onContext(name.replace(/^HEAD -> /, ''), event) }}><span className="ref-icon" style={{ background: color(lane, palette) }}>{tag ? <Tag size={11}/> : <GitBranch size={11}/>}</span><span className="ref-name">{label}</span>{synced && <span className="ref-remote" title={`También en ${synced}`}><Cloud size={11}/><span className="ref-remote-name">{synced.split('/')[0]}</span></span>}</span>
}

interface CommitRowProps {
  row: GraphRow<any>
  rowHeight: number
  selected: boolean
  contextActive: boolean
  matches: boolean
  showRemote: boolean
  showHeadBadge: boolean
  palette: string[]
  remotes: string[]
  onSelect: (commit: any) => void
  onContext: (commit: any, x: number, y: number, origin?: any) => void
  onRefContext: (name: string, event: React.MouseEvent) => void
  onRefOpen: (name: string) => void
}

interface CommitListProps extends Omit<CommitRowProps, 'row' | 'selected' | 'contextActive' | 'matches'> {
  rows: GraphRow<any>[]
  hasMore: boolean
  loadingMore: boolean
  selectedHash?: string
  contextHash?: string
  visibleHashes: Set<string> | null
  query: string
  onLoadMore: () => void
}

const CommitRow = React.memo(function CommitRow({ row, rowHeight, selected, contextActive, matches, showRemote, showHeadBadge, palette, remotes, onSelect, onContext, onRefContext, onRefOpen }: CommitRowProps) {
  const commit = row.commit, isHead = commit.refs.some(r => r.startsWith('HEAD'))
  const isRemote = name => remotes.some(remote => name.replace(/^HEAD -> /, '').startsWith(remote + '/'))
  const names = new Set(commit.refs.map(r => r.replace(/^HEAD -> /, '')))
  const syncedRemote = ref => { const name = ref.replace(/^HEAD -> /, ''); return isRemote(name) || ref.startsWith('tag: ') ? undefined : remotes.map(remote => remote + '/' + name).find(full => names.has(full)) }
  const merged = new Set(commit.refs.map(syncedRemote).filter(Boolean))
  const visibleRefs = commit.refs.filter(ref => !merged.has(ref) && (showRemote || !isRemote(ref))).map(ref => ({ ref, synced: showRemote ? syncedRemote(ref) : undefined }))
  return <button className={'commit-row '+(selected?'selected ':'')+(contextActive?'context-active ':'')+(isHead?'head ':'')+(!matches?'dim ':'')+(commit.parents.length > 1 ? 'merge':'')} onClick={() => onSelect(commit)} onContextMenu={event => { event.preventDefault(); onContext(commit, event.clientX, event.clientY, event.currentTarget) }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContext(commit, rect.left + 20, rect.bottom, event.currentTarget) } }}><Graph row={row} head={isHead} rowHeight={rowHeight} palette={palette}/><span className="commit-message">{isHead && showHeadBadge && <span className="head-badge" title="Estás aquí: HEAD apunta a este commit">HEAD</span>}{visibleRefs.map(({ ref, synced }) => <RefLabel key={ref} name={ref} lane={row.col} synced={synced} palette={palette} onContext={onRefContext} onOpen={onRefOpen}/>)}<span className="subject">{commit.subject}</span></span><span className="date">{date(commit.date)}</span><span className="author">{commit.author}</span><span className="hash">{commit.hash.slice(0,8)}</span></button>
})

const OVERSCAN = 12
const LOAD_AHEAD = 60

export const CommitList = React.memo(function CommitList({ rowHeight, rows, hasMore, loadingMore, selectedHash, contextHash, visibleHashes, query, showRemote, showHeadBadge, palette, remotes, onSelect, onContext, onRefContext, onRefOpen, onLoadMore }: CommitListProps) {
  const needle = query.toLowerCase()
  const scroller = useRef<any>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setView(old => old.top === el.scrollTop && old.height === el.clientHeight ? old : { top: el.scrollTop, height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => { el.removeEventListener('scroll', update); observer.disconnect() }
  }, [])
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN)
  useEffect(() => { if (hasMore && !loadingMore && end >= rows.length - LOAD_AHEAD) onLoadMore() }, [hasMore, loadingMore, end, rows.length, onLoadMore])
  return <div className="commit-list" ref={scroller}>{rows.length === 0 ? <div className="no-results">Este repositorio todavía no tiene commits.</div> : <>
    <div style={{ paddingTop: start * rowHeight, paddingBottom: (rows.length - end) * rowHeight }}>{rows.slice(start, end).map(row => {
      const c = row.commit
      const matches = (!visibleHashes || visibleHashes.has(c.hash)) && (!needle || `${c.subject} ${c.message} ${c.author} ${c.email} ${c.hash} ${c.refs.join(' ')}`.toLowerCase().includes(needle))
      return <CommitRow key={c.hash} row={row} rowHeight={rowHeight} selected={selectedHash === c.hash} contextActive={contextHash === c.hash} matches={matches} showRemote={showRemote} showHeadBadge={showHeadBadge} palette={palette} remotes={remotes} onSelect={onSelect} onContext={onContext} onRefContext={onRefContext} onRefOpen={onRefOpen}/>
    })}</div>
    {(hasMore || loadingMore) && <div className="history-more" role="status">{loadingMore ? <><LoaderCircle className="spin" size={14}/> Cargando más historial…</> : 'Desplázate para cargar más'}</div>}
  </>}</div>
})
