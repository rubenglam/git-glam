import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IssueTokenForm } from './issue-token.tsx'
import { FilterMenu, isFilterMenuOpen } from './filter-menu.tsx'
import { ArrowLeft, ExternalLink, CircleCheck, CircleDot, CircleMinus, CircleX, Flag, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, KeyRound, LoaderCircle, MessageSquare, RefreshCw, Search, X } from 'lucide-react'

const STATES = [['open', 'Abiertos'], ['closed', 'Cerrados'], ['all', 'Todos']]
// `states` says whether the open/closed filter applies.
const SECTIONS = [
  { id: 'issues', label: 'Issues', icon: CircleDot, states: true, empty: 'No hay issues.' },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest, states: true, empty: 'No hay pull requests.' },
  { id: 'milestones', label: 'Milestones', icon: Flag, states: true, empty: 'No hay milestones.' },
  { id: 'runs', label: 'Actions', icon: CircleCheck, states: false, empty: 'No hay ejecuciones de workflows.' },
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
      body: <><Flag size={17} className={'issue-' + milestone.state}/><span className="issue-main"><b>{milestone.title}</b><small>{milestone.description || (milestone.dueOn ? '' : 'Sin fecha límite')}{milestone.dueOn ? `${milestone.description ? ' · ' : ''}vence el ${date(milestone.dueOn)}` : ''}</small></span>{milestone.open != null && <span className="milestone-progress" title={`${percent}% completado`}><span className="milestone-bar"><i style={{ width: percent + '%' }}/></span><small>{milestone.open} abiertos · {milestone.closed} cerrados</small></span>}</>,
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
      fetchList(root, item.id, 'open', {}, false).catch(() => {})
    }
  }, () => {})
}

function ForgeMarkdown({ text }) {
  return <div className="forge-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => href && /^https:\/\//i.test(href) ? <a href={href} onClick={event => { event.preventDefault(); window.gitGraph.openIssue(href).catch(() => {}) }}>{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="forge-image-placeholder">[Imagen: {alt || 'sin descripción'}]</span>,
    input: ({ checked }) => <input type="checkbox" checked={checked} disabled readOnly/>,
  }}>{text}</ReactMarkdown></div>
}

function ForgeDetail({ root, section, item, onBack }) {
  const [detail, setDetail] = useState<any>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [comment, setComment] = useState(''), [commentError, setCommentError] = useState(''), [sending, setSending] = useState(false)
  async function sendComment(event) {
    event.preventDefault()
    if (sending || !comment.trim()) return
    setSending(true); setCommentError('')
    try {
      const posted = await window.gitGraph.forgeComment(root, section, item.number, comment)
      setDetail(old => ({ ...old, comments: [...old.comments, posted] }))
      setComment('')
      clearForgeCache(root)
    } catch (failure) { setCommentError(failure.message || String(failure)) } finally { setSending(false) }
  }
  useEffect(() => {
    let active = true
    setDetail(null); setError('')
    window.gitGraph.forgeDetail(root, section, section === 'runs' ? item.id : item.number).then(value => { if (active) setDetail(value) }, failure => { if (active) setError(failure.message || String(failure)) })
    return () => { active = false }
  }, [root, section, item, attempt])
  return <div className="forge-detail">
    <div className="forge-detail-topline"><button className="tool-button" title="Volver a la lista" aria-label="Volver a la lista" onClick={onBack}><ArrowLeft size={17}/></button><h2>{detail?.title || item.title} {section !== 'runs' && <small>#{item.number}</small>}</h2><button className="tool-button" title="Abrir en el navegador" aria-label="Abrir en el navegador" onClick={() => window.gitGraph.openIssue(detail?.url || item.url).catch(failure => setError(failure.message || String(failure)))}><ExternalLink size={16}/></button></div>
    {error && <div className="action-error" role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>}
    {!detail && !error && <p className="panel-empty">Cargando detalles…</p>}
    {detail && <article>
      <header className="forge-detail-heading">
        <div className="forge-detail-meta"><span className={'forge-state ' + (detail.state === 'open' || detail.state === 'opened' ? 'is-open' : '')}>{({ open: 'Abierto', opened: 'Abierto', closed: 'Cerrado', merged: 'Fusionado' })[detail.state] || detail.state}</span>{detail.draft && <span>Borrador</span>}{detail.author && <span>{detail.author}</span>}{detail.createdAt && <span>Creado el {date(detail.createdAt)}</span>}{detail.updatedAt && <span>Actualizado el {date(detail.updatedAt)}</span>}</div>
      </header>
      <div className="forge-detail-layout"><div className="forge-detail-content">
        {section !== 'runs' && <section className="forge-card"><div className="forge-card-header">Descripción</div><div className="forge-card-body">{detail.body ? <ForgeMarkdown text={detail.body}/> : <span className="forge-muted">Sin descripción.</span>}</div></section>}
        {(section === 'issues' || section === 'pulls') && <section className="forge-conversation"><h3>Comentarios <span>{detail.comments.length}</span></h3>{detail.commentsError && <p className="action-error" role="alert">No se pudieron cargar los comentarios anteriores: {detail.commentsError}</p>}{detail.comments.length ? <>{detail.comments.map((comment, index) => <div className="forge-card forge-comment" key={index}><div className="forge-card-header"><strong>{comment.author || 'Usuario'}</strong><span>{date(comment.createdAt)}</span></div><div className="forge-card-body"><ForgeMarkdown text={comment.body}/></div></div>)}{detail.comments.length >= 100 && <p className="forge-muted">Se muestran los primeros 100 comentarios.</p>}</> : <p className="forge-muted">No hay comentarios.</p>}<form className="forge-comment-form forge-card" onSubmit={sendComment}><label className="forge-card-header" htmlFor="forge-comment-input">Añadir comentario</label><div className="forge-card-body"><textarea id="forge-comment-input" value={comment} maxLength={65536} disabled={sending} onChange={event => setComment(event.target.value)} placeholder="Escribe un comentario…" rows={4}/><div className="forge-comment-actions"><span>Admite Markdown</span><button type="submit" disabled={sending || !comment.trim()}>{sending ? 'Publicando…' : 'Publicar comentario'}</button></div>{commentError && <p className="action-error" role="alert">{commentError}</p>}</div></form></section>}
        {section === 'runs' && <section className="forge-card"><div className="forge-card-header">Ejecución</div><div className="forge-card-body">{detail.event} · {detail.status}{detail.conclusion && ` · ${detail.conclusion}`}</div></section>}
      </div><aside className="forge-detail-sidebar">
        {detail.labels.length > 0 && <div><h3>Etiquetas</h3><Labels labels={detail.labels}/></div>}
        {detail.assignees.length > 0 && <div><h3>Asignados</h3><p>{detail.assignees.join(', ')}</p></div>}
        {detail.milestone && <div><h3>Milestone</h3><p>{detail.milestone}</p></div>}
        {(detail.head || detail.base) && <div><h3>Ramas</h3><p className="forge-branches">{detail.head}{detail.base && ` → ${detail.base}`}</p></div>}
        {detail.changedFiles != null && <div><h3>Cambios</h3><p>{detail.changedFiles} archivos · <span className="forge-additions">+{detail.additions}</span> <span className="forge-deletions">−{detail.deletions}</span></p></div>}
        {section === 'milestones' && (detail.open != null || detail.dueOn) && <div><h3>Milestone</h3>{detail.open != null && <p>{detail.open} abiertos · {detail.closed} cerrados</p>}{detail.dueOn && <p>Vence el {date(detail.dueOn)}</p>}</div>}
      </aside></div>
    </article>}
  </div>
}

// Repository issues, change requests, milestones and CI runs.
export function ForgeDialog({ root, onClose }) {
  const [info, setInfo] = useState(() => peek(cacheKey(root, 'info')) ?? null), [section, setSection] = useState('issues'), [state, setState] = useState('open')
  const [data, setData] = useState<any>(null), [query, setQuery] = useState(''), [tokenOpen, setTokenOpen] = useState(false)
  const [filters, setFilters] = useState<Record<string, any>>({}), [facets, setFacets] = useState({})
  const [refreshing, setRefreshing] = useState(false), [selected, setSelected] = useState<any>(null)
  const github = info?.provider === 'github'
  const serverFilters = JSON.stringify(section === 'milestones' ? {} : filters)
  const current = (info?.provider === 'gitlab' && section === 'pulls' ? { ...SECTIONS[1], label: 'Merge requests', empty: 'No hay merge requests.' } : info?.provider === 'gitlab' && section === 'runs' ? { ...SECTIONS[3], label: 'Pipelines', empty: 'No hay pipelines.' } : SECTIONS.find(item => item.id === section))!
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
    const key = event => { if (event.key === 'Escape' && !isFilterMenuOpen()) { event.stopPropagation(); if (selected) setSelected(null); else onClose() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [onClose, selected])
  const rows = useMemo(() => {
    if (!data?.items || data.section !== section) return []
    const needle = query.trim().toLowerCase()
    const items = section === 'milestones' ? [...data.items].sort(milestoneSorters[filters.sort || 'due-asc']) : data.items
    return items.map(item => ({ ...ROWS[section](item), item })).filter(row => !needle || row.text.toLowerCase().includes(needle))
  }, [data, query, section, filters.sort])
  const defs = github ? FILTERS[section] : []
  const dirty = defs.some(def => filters[def.key] && filters[def.key] !== def.defaultValue)
  const open = item => setSelected(item)
  const sections = SECTIONS.map(item => info?.provider === 'gitlab' && item.id === 'pulls' ? { ...item, label: 'Merge requests', empty: 'No hay merge requests.' } : info?.provider === 'gitlab' && item.id === 'runs' ? { ...item, label: 'Pipelines', empty: 'No hay pipelines.' } : item)
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
    <nav className="forge-sections" aria-label="Secciones">{sections.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setSection(item.id); setSelected(null); setQuery(''); setFilters({}) }}><item.icon size={15}/>{item.label}</button>)}</nav>
    {(tokenOpen || data?.error) && <IssueTokenForm root={root} onChanged={() => { clearForgeCache(root); load(true) }}/>}
    {!selected && <div className="issues-searchbar"><label className="issues-search"><Search size={15}/><input value={query} placeholder="Buscar…" onChange={event => setQuery(event.target.value)} autoFocus/>{query && <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}><X size={14}/></button>}</label>
      {defs.length > 0 && <div className="issues-filters">{defs.map(def => <FilterMenu key={def.key} label={def.label} value={filters[def.key] || def.defaultValue || ''} defaultValue={def.defaultValue} options={def.items || facets[def.facet] || []} searchable={def.searchable} free={def.free} onChange={value => setFilters(old => ({ ...old, [def.key]: value }))}/>)}{dirty && <button type="button" className="filter-reset" onClick={() => setFilters({})}><X size={13}/> Limpiar filtros</button>}</div>}
    </div>}
    <div className="issues-body">
      {selected ? <ForgeDetail root={root} section={section} item={selected} onBack={() => setSelected(null)}/> : !data || (data.items && data.section !== section) ? <p className="panel-empty">Cargando…</p>
        : data.error ? <p className="action-error" role="alert">{data.error}</p>
        : rows.length ? <ul className="issues-items">{rows.map(row => <li key={row.key}><button onClick={() => open(row.item)}>{row.body}</button></li>)}</ul>
        : <p className="panel-empty">{current.empty}</p>}
    </div>
  </div></div>
}
