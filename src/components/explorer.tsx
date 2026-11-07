import React, { useMemo, useState } from 'react'
import { Archive, ChevronDown, ChevronRight, Cloud, FolderGit2, GitBranch, Plus, Search, Tag, X } from 'lucide-react'
import { branchItems, stashItems, tagItems } from './manage.tsx'

const baseName = (path: string) => path.split(/[\\/]/).pop() || path
const matcher = (query: string) => { const needle = query.trim().toLowerCase(); return (...texts: (string | undefined)[]) => !needle || texts.some(text => text?.toLowerCase().includes(needle)) }

export function SyncBadge({ info }) {
  if (info.gone) return <em className="sync-badge gone" title={`La rama remota ${info.upstream} ya no existe`}>sin remota</em>
  if (!info.ahead && !info.behind) return null
  return <em className="sync-badge" title={`${info.ahead} por enviar · ${info.behind} por recibir (${info.upstream})`}>{info.ahead > 0 && <span>↑{info.ahead}</span>}{info.behind > 0 && <span>↓{info.behind}</span>}</em>
}

function Section({ title, count, total, open, onToggle, action }: { title: string, count: number, total?: number, open: boolean, onToggle: () => void, action?: { label: string, disabled?: boolean, onClick: () => void } }) {
  return <div className="section-head">
    <button className="section-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}{title}<span className="section-count">{total !== undefined && total !== count ? `${count}/${total}` : count}</span></button>
    {action && <button className="section-action" title={action.label} aria-label={action.label} disabled={action.disabled} onClick={action.onClick}><Plus size={14}/></button>}
  </div>
}

export interface ExplorerProps {
  repo: any
  filter: string
  selected: any
  busy: boolean
  tags: any[]
  remoteBranches: any[]
  branchDates: Record<string, string>
  open: { branches: boolean, remotes: boolean, worktrees: boolean, stashes: boolean, tags: boolean }
  onToggle: (section: 'branches' | 'remotes' | 'worktrees' | 'stashes' | 'tags') => void
  onFilter: (value: string) => void
  onCheckout: (name: string) => void
  onSelectCommit: (commit: any) => void
  onSelectWorktree: (path: string) => void
  onManage: (request: any) => void
  onCopyTag: (name: string) => void
  onMenu: (items: any[], event: React.MouseEvent) => void
}

export function Explorer({ repo, filter, selected, busy, tags, remoteBranches, branchDates, open, onToggle, onFilter, onCheckout, onSelectCommit, onSelectWorktree, onManage, onCopyTag, onMenu }: ExplorerProps) {
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const match = useMemo(() => matcher(query), [query])
  const expanded = (section: keyof ExplorerProps['open']) => searching || open[section]
  const branches = useMemo(() => [...repo.branches].sort((a, b) => (a === repo.branch ? -1 : b === repo.branch ? 1 : 0)).filter(name => match(name)), [repo.branches, repo.branch, match])
  const remotes = useMemo(() => remoteBranches.filter(branch => match(branch.name)), [remoteBranches, match])
  const worktrees = useMemo(() => repo.worktrees.filter(item => match(baseName(item.path), item.branch)), [repo.worktrees, match])
  const allStashes = repo.stashes || []
  const stashes = useMemo(() => allStashes.filter(stash => match(stash.stash, stash.subject)), [allStashes, match])
  const tagList = useMemo(() => tags.filter(tag => match(tag.name, tag.message)), [tags, match])
  const showAllBranches = !searching || match('todas las ramas')
  const nothing = searching && !branches.length && !remotes.length && !worktrees.length && !stashes.length && !tagList.length

  return <>
    <div className="panel-repo" title={repo.root}><FolderGit2 size={16}/><strong>{baseName(repo.root)}</strong><span className="repo-branch" title="Rama actual"><GitBranch size={12}/>{repo.branch}</span></div>
    <div className="explorer-search"><Search size={13}/><input value={query} placeholder="Filtrar ramas, stashes, etiquetas…" aria-label="Filtrar el explorador" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }}/>{query && <button title="Limpiar filtro" aria-label="Limpiar filtro" onClick={() => setQuery('')}><X size={13}/></button>}</div>

    <Section title="RAMAS" count={branches.length} total={repo.branches.length} open={expanded('branches')} onToggle={() => onToggle('branches')}/>
    {expanded('branches') && <div className="panel-items">
      {showAllBranches && <button className={'side-row '+(filter === 'all' ? 'active' : '')} onClick={() => onFilter('all')}><GitBranch size={15}/><span>Todas las ramas</span></button>}
      {branches.map(branch => <button key={branch} className={'side-row branch-row '+(filter === branch ? 'active ' : '')+(branch === repo.branch ? 'current' : '')} title={`${branch}${branchDates[branch] ? ' · ' + branchDates[branch] : ''}\nDoble clic para cambiar a esta rama`} onClick={() => onFilter(branch)} onDoubleClick={() => onCheckout(branch)} onContextMenu={event => { event.preventDefault(); onMenu(branchItems({ ref: 'refs/heads/' + branch, name: branch, remote: false }, { current: repo.branch, tracking: Boolean(repo.sync?.[branch]) }, onManage), event) }}>
        <GitBranch size={15}/><span>{branch}</span>
        {repo.sync?.[branch] && <SyncBadge info={repo.sync[branch]}/>}
        {branchDates[branch] && branch !== repo.branch && <small className="row-date">{branchDates[branch]}</small>}
        {branch === repo.branch && <i className="current-pill">actual</i>}
      </button>)}
      {searching && !branches.length && <p className="panel-empty stash-empty">Sin coincidencias.</p>}
    </div>}

    {(!searching || remotes.length > 0) && <>
      <Section title="REMOTAS" count={remotes.length} total={remoteBranches.length} open={expanded('remotes')} onToggle={() => onToggle('remotes')}/>
      {expanded('remotes') && <div className="panel-items">
        {remotes.map(branch => <button key={branch.ref} className="side-row remote-row" title={`${branch.name}\nDoble clic para crear una rama local y cambiar a ella`} onClick={() => onFilter(branch.name)} onDoubleClick={() => onManage({ kind: 'checkout-remote', branch })} onContextMenu={event => { event.preventDefault(); onMenu(branchItems(branch, { current: repo.branch, tracking: false }, onManage), event) }}><Cloud size={15}/><span>{branch.name}</span>{branch.date && <small className="row-date">{branch.date}</small>}</button>)}
        {!remoteBranches.length && <p className="panel-empty stash-empty">No hay ramas remotas sin rama local.</p>}
      </div>}
    </>}

    {(!searching || worktrees.length > 0) && <>
      <Section title="WORKTREES" count={worktrees.length} total={repo.worktrees.length} open={expanded('worktrees')} onToggle={() => onToggle('worktrees')}/>
      {expanded('worktrees') && <div className="panel-items">{worktrees.map(worktree => <button key={worktree.path} className={'side-row worktree-row '+(worktree.path.toLowerCase() === repo.root.toLowerCase() ? 'active' : '')} onClick={() => onSelectWorktree(worktree.path)} title={worktree.path}><FolderGit2 size={15}/><span><b>{baseName(worktree.path)}</b><small>{worktree.branch}</small></span></button>)}</div>}
    </>}

    {(!searching || stashes.length > 0) && <>
      <Section title="STASHES" count={stashes.length} total={allStashes.length} open={expanded('stashes')} onToggle={() => onToggle('stashes')} action={{ label: repo.changes.length ? 'Guardar los cambios locales en un stash' : 'No hay cambios que guardar', disabled: busy || !repo.changes.length, onClick: () => onManage({ kind: 'stash-create' }) }}/>
      {expanded('stashes') && <div className="panel-items stash-list">
        {stashes.map(stash => <button key={stash.stash + stash.hash} className={'side-row stash-row '+(selected?.stash && selected.hash === stash.hash ? 'active' : '')} title={stash.stash + ' · ' + stash.subject} aria-pressed={Boolean(selected?.stash && selected.hash === stash.hash)} onClick={() => onSelectCommit(stash)} onContextMenu={event => { event.preventDefault(); onMenu(stashItems(stash, onManage), event) }}><Archive size={15}/><span><b>{stash.stash}</b><small>{stash.subject}</small></span></button>)}
        {!allStashes.length && <p className="panel-empty stash-empty">No hay stashes guardados.</p>}
      </div>}
    </>}

    {(!searching || tagList.length > 0) && <>
      <Section title="ETIQUETAS" count={tagList.length} total={tags.length} open={expanded('tags')} onToggle={() => onToggle('tags')} action={{ label: 'Nueva etiqueta en HEAD', disabled: busy, onClick: () => onManage({ kind: 'tag-create' }) }}/>
      {expanded('tags') && <div className="panel-items">
        {tagList.map(tag => <button key={tag.name} className="side-row tag-row" title={tag.name + (tag.message ? ' · ' + tag.message : '')} onClick={() => { const commit = repo.commits.find(item => item.hash === tag.commit); if (commit) onSelectCommit(commit) }} onContextMenu={event => { event.preventDefault(); onMenu(tagItems(tag, onManage, onCopyTag), event) }}><Tag size={15}/><span>{tag.name}</span>{tag.annotated && <em>anotada</em>}</button>)}
        {!tags.length && <p className="panel-empty stash-empty">No hay etiquetas.</p>}
      </div>}
    </>}
    {nothing && <p className="panel-empty">Nada coincide con «{query.trim()}».</p>}
  </>
}
