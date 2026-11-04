import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { IssueTokenForm } from './issue-token.tsx'
import { FilterMenu, isFilterMenuOpen } from './filter-menu.tsx'
import { CircleCheck, CircleDot, CircleMinus, CircleX, Flag, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, KeyRound, LoaderCircle, MessageSquare, RefreshCw, Search, X } from 'lucide-react'

const STATES = [['open', 'Abiertos'], ['closed', 'Cerrados'], ['all', 'Todos']]
// `github` sections only exist for GitHub remotes; `states` says whether the open/closed filter applies.
const SECTIONS = [
  { id: 'issues', label: 'Issues', icon: CircleDot, states: true, empty: 'No hay issues.' },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest, states: true, github: true, empty: 'No hay pull requests.' },
  { id: 'milestones', label: 'Milestones', icon: Flag, states: true, github: true, empty: 'No hay milestones.' },
  { id: 'runs', label: 'Actions', icon: CircleCheck, states: false, github: true, empty: 'No hay ejecuciones de workflows.' },
]

const options = list => list.map(([value, label]) => ({ value, label }))
const SORT_ITEMS = options([['created-desc', 'Más recientes'], ['created-asc', 'Más antiguos'], ['comments-desc', 'Más comentados'], ['comments-asc', 'Menos comentados'], ['updated-desc', 'Actualizados recientemente'], ['updated-asc', 'Actualizados hace más tiempo']])
const MILESTONE_SORTS = options([['due-asc', 'Fecha límite más próxima'], ['due-desc', 'Fecha límite más lejana'], ['updated-desc', 'Actualizado recientemente'], ['updated-asc', 'Actualizado hace más tiempo'], ['complete-desc', 'Más completados'], ['complete-asc', 'Menos completados'], ['issues-desc', 'Más issues'], ['issues-asc', 'Menos issues']])
const PULL_STATUS = options([['draft', 'Borrador'], ['ready', 'Listo para revisión'], ['merged', 'Fusionado']])
const REVIEWS = options([['none', 'Sin revisar'], ['required', 'Revisión requerida'], ['approved', 'Aprobado'], ['changes_requested', 'Cambios solicitados']])
const RUN_EVENTS = options(['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_call', 'workflow_run', 'release', 'issues'].map(value => [value, value]))
const RUN_STATUS = options([['success', 'Correcto'], ['failure', 'Fallido'], ['in_progress', 'En curso'], ['queued', 'En cola'], ['waiting', 'En espera'], ['cancelled', 'Cancelado'], ['skipped', 'Omitido'], ['timed_out', 'Tiempo agotado']])
// Filters per section, mirroring GitHub's UI. `facet` names the lookup list (from the API) feeding the menu; `free` accepts typed values.
const ISSUE_FILTERS = [
  { key: 'author', label: 'Autor', facet: 'people', free: true }, { key: 'label', label: 'Etiqueta', facet: 'labels', searchable: true },
  { key: 'milestone', label: 'Milestone', facet: 'milestones', searchable: true }, { key: 'assignee', label: 'Asignado', facet: 'people', free: true },
]
const FILTERS = {
  issues: [...ISSUE_FILTERS, { key: 'sort', label: 'Orden', items: SORT_ITEMS, defaultValue: 'created-desc' }],
  pulls: [...ISSUE_FILTERS, { key: 'status', label: 'Estado', items: PULL_STATUS }, { key: 'review', label: 'Revisión', items: REVIEWS }, { key: 'sort', label: 'Orden', items: SORT_ITEMS, defaultValue: 'created-desc' }],
  milestones: [{ key: 'sort', label: 'Orden', items: MILESTONE_SORTS, defaultValue: 'due-asc' }],
  runs: [
    { key: 'workflow', label: 'Workflow', facet: 'workflows', searchable: true }, { key: 'event', label: 'Evento', items: RUN_EVENTS }, { key: 'status', label: 'Estado', items: RUN_STATUS },
    { key: 'branch', label: 'Rama', facet: 'branches', free: true }, { key: 'actor', label: 'Actor', facet: 'people', free: true },
  ],
}

const milestoneSorters = {
  'due-asc': (a, b) => (a.dueOn || '9999').localeCompare(b.dueOn || '9999'), 'due-desc': (a, b) => (b.dueOn || '').localeCompare(a.dueOn || ''),
  'updated-desc': (a, b) => b.updatedAt.localeCompare(a.updatedAt), 'updated-asc': (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  'complete-desc': (a, b) => progress(b) - progress(a), 'complete-asc': (a, b) => progress(a) - progress(b),
  'issues-desc': (a, b) => b.open + b.closed - (a.open + a.closed), 'issues-asc': (a, b) => a.open + a.closed - (b.open + b.closed),
}
const progress = milestone => milestone.open + milestone.closed ? milestone.closed / (milestone.open + milestone.closed) : 0

const textColor = hex => { const n = parseInt(hex, 16); return (((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000) > 140 ? '#111' : '#fff' }
const date = value => value ? new Date(value).toLocaleDateString() : ''
const Labels = ({ labels }) => <span className="issue-labels">{labels.map(label => <em key={label.name} style={label.color ? { background: '#' + label.color, color: textColor(label.color) } : undefined}>{label.name}</em>)}</span>

function pullIcon(pull) {
  if (pull.state === 'merged') return <GitMerge size={17} className="issue-closed"/>
  if (pull.state === 'closed') return <GitPullRequestClosed size={17} className="pr-closed"/>
  return pull.draft ? <GitPullRequestDraft size={17} className="run-muted"/> : <GitPullRequest size={17} className="issue-open"/>
}

function runIcon(run) {
  if (run.status !== 'completed') return <LoaderCircle size={17} className="run-pending"/>
  if (run.conclusion === 'success') return <CircleCheck size={17} className="issue-open"/>
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return <CircleX size={17} className="pr-closed"/>
  return <CircleMinus size={17} className="run-muted"/>
}

const runState = run => run.status !== 'completed' ? (run.status === 'queued' ? 'en cola' : 'en curso') : ({ success: 'correcto', failure: 'fallido', cancelled: 'cancelado', skipped: 'omitido', timed_out: 'tiempo agotado' }[run.conclusion] || run.conclusion)

// Row content per section; the whole row is a button that opens the item in the browser.
const ROWS = {
  issues: issue => ({
    key: issue.number, text: `#${issue.number} ${issue.title} ${issue.author} ${issue.labels.map(l => l.name).join(' ')}`,
    body: <><CircleDot size={17} className={'issue-' + issue.state}/><span className="issue-main"><b>{issue.title}</b><small>#{issue.number} · {issue.author} · {date(issue.createdAt)}</small></span><Labels labels={issue.labels}/>{issue.comments > 0 && <span className="issue-comments"><MessageSquare size={13}/>{issue.comments}</span>}</>,
  }),
  pulls: pull => ({
    key: pull.number, text: `#${pull.number} ${pull.title} ${pull.author} ${pull.head} ${pull.base} ${pull.labels.map(l => l.name).join(' ')}`,
    body: <>{pullIcon(pull)}<span className="issue-main"><b>{pull.title}</b><small>#{pull.number} · {pull.author} · {date(pull.createdAt)}{pull.head ? ` · ${pull.head} → ${pull.base}` : ''}{pull.draft ? ' · borrador' : ''}</small></span><Labels labels={pull.labels}/></>,
  }),
  milestones: milestone => {
    const total = milestone.open + milestone.closed, percent = total ? Math.round(milestone.closed / total * 100) : 0
    return {
      key: milestone.number, text: `${milestone.title} ${milestone.description}`,
      body: <><Flag size={17} className={'issue-' + milestone.state}/><span className="issue-main"><b>{milestone.title}</b><small>{milestone.description || (milestone.dueOn ? '' : 'Sin fecha límite')}{milestone.dueOn ? `${milestone.description ? ' · ' : ''}vence el ${date(milestone.dueOn)}` : ''}</small></span><span className="milestone-progress" title={`${percent}% completado`}><span className="milestone-bar"><i style={{ width: percent + '%' }}/></span><small>{milestone.open} abiertos · {milestone.closed} cerrados</small></span></>,
    }
  },
  runs: run => ({
    key: run.id, text: `${run.title} ${run.name} ${run.branch} ${run.event} ${run.author} ${runState(run)}`,
    body: <>{runIcon(run)}<span className="issue-main"><b>{run.title}</b><small>{run.name} #{run.number} · {run.branch} · {run.event} · {run.author} · {date(run.createdAt)}</small></span><span className={'run-state run-' + (run.status !== 'completed' ? 'pending' : run.conclusion)}>{runState(run)}</span></>,
  }),
}

// Stale-while-revalidate cache shared by prefetch and the dialog: entries survive closing the dialog and are refreshed in the background.
const FRESH_MS = 5 * 60_000
const cache = new Map()
const cacheKey = (root, kind, ...rest) => JSON.stringify([root, kind, ...rest])
const forgeParams = (section, state, filters) => { const def = SECTIONS.find(item => item.id === section)!; return { state: def.states ? state : 'all', filters: section === 'milestones' ? {} : filters } }
const stale = entry => !entry || Date.now() - entry.at > FRESH_MS
// Fetches through the cache; failures are never cached and reject so callers can keep showing older data.
function cached(key, force, fetcher) {
  const entry = cache.get(key)
  if (!force && entry && !stale(entry)) return Promise.resolve(entry.value)
  if (entry?.pending) return entry.pending
  const pending = fetcher().then(value => { cache.set(key, { value, at: Date.now() }); return value }, error => { const old = cache.get(key); if (old) cache.set(key, { value: old.value, at: old.at }); throw error })
  cache.set(key, { ...(entry || { value: undefined, at: 0 }), pending })
  return pending
}
const fetchList = (root, section, state, filters, force) => cached(cacheKey(root, 'list', section, state, filters), force, () => window.gitGraph.forgeList(root, section, forgeParams(section, state, filters)).then(result => { if (result?.error) throw new Error(result.error); return result }))
const fetchFacets = (root, section, force) => cached(cacheKey(root, 'facets', section), force, () => window.gitGraph.forgeFacets(root, section))
const fetchInfo = root => cached(cacheKey(root, 'info'), false, () => window.gitGraph.forgeInfo(root))
const peek = key => { const entry = cache.get(key); return entry?.value === undefined ? undefined : entry.value }
export const clearForgeCache = root => { for (const key of [...cache.keys()]) if (JSON.parse(key)[0] === root) cache.delete(key) }

// Warm the cache when a project is opened so the dialog shows instantly.
export function prefetchForge(root) {
  fetchInfo(root).then(info => {
    for (const item of SECTIONS) {
      if (item.github && info?.provider !== 'github') continue
      fetchList(root, item.id, 'open', {}, false).catch(() => {})
    }
  }, () => {})
}

// Large modal listing the repository's issues and, for GitHub remotes, pull requests, milestones and workflow runs.
export function ForgeDialog({ root, onClose }) {
  const [info, setInfo] = useState(() => peek(cacheKey(root, 'info')) ?? null), [section, setSection] = useState('issues'), [state, setState] = useState('open')
  const [data, setData] = useState<any>(null), [query, setQuery] = useState(''), [tokenOpen, setTokenOpen] = useState(false)
  const [filters, setFilters] = useState<Record<string, any>>({}), [facets, setFacets] = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const github = info?.provider === 'github'
  const serverFilters = JSON.stringify(section === 'milestones' ? {} : filters)
  const current = SECTIONS.find(item => item.id === section)!
  useEffect(() => { let active = true; fetchInfo(root).then(result => { if (active) setInfo(result) }, () => {}); return () => { active = false } }, [root])
  const listState = current.states ? state : 'all'
  // Shows cached data immediately (if any) and revalidates in the background; `force` bypasses the freshness window.
  const load = useCallback((force = false) => {
    let active = true
    const filtersNow = JSON.parse(serverFilters), hit = peek(cacheKey(root, 'list', section, listState, filtersNow))
    setData(hit ? { ...hit, section } : null)
    setRefreshing(true)
    fetchList(root, section, listState, filtersNow, force).then(result => { if (active) setData({ ...result, section }) }, e => { if (active) setData(old => old?.items ? old : { error: e.message || String(e) }) }).finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [root, section, listState, serverFilters])
  useEffect(() => load(), [load])
  // Quiet periodic refresh while the dialog is open.
  useEffect(() => {
    let active = true
    const timer = setInterval(() => {
      fetchList(root, section, listState, JSON.parse(serverFilters), false).then(result => { if (active) setData({ ...result, section }) }, () => {})
    }, FRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [root, section, listState, serverFilters])
  useEffect(() => {
    setFacets(peek(cacheKey(root, 'facets', section)) ?? {})
    if (!github || section === 'milestones') return
    let active = true
    fetchFacets(root, section, false).then(result => { if (active) setFacets(result) }, () => {})
    return () => { active = false }
  }, [root, section, github])
  useEffect(() => {
    const key = event => { if (event.key === 'Escape' && !isFilterMenuOpen()) { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  const rows = useMemo(() => {
    if (!data?.items || data.section !== section) return []
    const needle = query.trim().toLowerCase()
    const items = section === 'milestones' ? [...data.items].sort(milestoneSorters[filters.sort || 'due-asc']) : data.items
    return items.map(item => ({ ...ROWS[section](item), item })).filter(row => !needle || row.text.toLowerCase().includes(needle))
  }, [data, query, section, filters.sort])
  const defs = github ? FILTERS[section] : []
  const dirty = defs.some(def => filters[def.key] && filters[def.key] !== def.defaultValue)
  const open = item => window.gitGraph.openIssue(item.url).catch(() => {})
  const sections = SECTIONS.filter(item => !item.github || info?.provider !== 'gitlab')
  return <div className="issues-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="issues-page" role="dialog" aria-modal="true" aria-label={current.label}>
    <header className="issues-head">
      <h2><current.icon size={18}/> {current.label}{info && <small>{info.owner}/{info.repo}</small>}</h2>
      <div className="issues-tools">
        {current.states && <div className="issues-tabs" role="tablist" aria-label="Estado">{STATES.map(([value, label]) => <button key={value} role="tab" aria-selected={state === value} className={state === value ? 'active' : ''} onClick={() => setState(value)}>{label}</button>)}</div>}
        <button className={'tool-button ' + (tokenOpen ? 'active' : '')} title="Token de acceso" aria-label="Token de acceso" aria-pressed={tokenOpen} onClick={() => setTokenOpen(!tokenOpen)}><KeyRound size={16}/></button>
        <button className="tool-button" title="Actualizar" aria-label="Actualizar" onClick={() => load(true)}><RefreshCw size={16} className={refreshing ? 'spin' : undefined}/></button>
        <button className="tool-button" title="Cerrar (Esc)" aria-label="Cerrar" onClick={onClose}><X size={18}/></button>
      </div>
    </header>
    <nav className="forge-sections" aria-label="Secciones">{sections.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setSection(item.id); setQuery(''); setFilters({}) }}><item.icon size={15}/>{item.label}</button>)}</nav>
    {(tokenOpen || data?.error) && <IssueTokenForm root={root} onChanged={() => { clearForgeCache(root); load(true) }}/>}
    <div className="issues-searchbar"><label className="issues-search"><Search size={15}/><input value={query} placeholder="Buscar…" onChange={event => setQuery(event.target.value)} autoFocus/>{query && <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><X size={14}/></button>}</label>
      {defs.length > 0 && <div className="issues-filters">{defs.map(def => <FilterMenu key={def.key} label={def.label} value={filters[def.key] || def.defaultValue || ''} defaultValue={def.defaultValue} options={def.items || facets[def.facet] || []} searchable={def.searchable} free={def.free} onChange={value => setFilters(old => ({ ...old, [def.key]: value }))}/>)}{dirty && <button type="button" className="filter-reset" onClick={() => setFilters({})}><X size={13}/> Limpiar filtros</button>}</div>}
    </div>
    <div className="issues-body">
      {!data || (data.items && data.section !== section) ? <p className="panel-empty">Cargando…</p>
        : data.error ? <p className="action-error" role="alert">{data.error}</p>
        : rows.length ? <ul className="issues-items">{rows.map(row => <li key={row.key}><button onClick={() => open(row.item)}>{row.body}</button></li>)}</ul>
        : <p className="panel-empty">{current.empty}</p>}
    </div>
  </div></div>
}
