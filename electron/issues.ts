import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

const assertDir = dir => { if (typeof dir !== 'string' || !dir) throw new Error('Ruta no válida') }
const STATES = new Set(['open', 'closed', 'all'])

async function git(cwd, args) {
  try { return (await run('git', args, { cwd, timeout: 30000, windowsHide: true })).stdout } catch (error) { throw new Error(error.stderr?.trim() || error.message) }
}

// Reads an https/ssh/scp-style remote URL into { provider: 'github' | 'gitlab', host, path }; null for other hosts.
// SSH host aliases such as `github.com-work` are mapped back to the real host.
function parseRemote(url) {
  const match = /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?|(?:[^@/\s]+@)?)([^:/\s]+)(?::\d+)?[:/]+(.+?)(?:\.git)?\/?$/.exec(String(url).trim())
  if (!match) return null
  const host = match[1].toLowerCase(), path = match[2].replace(/^\/+/, '')
  if (/^(?:www\.|ssh\.)?github\.com(?:-.*)?$/.test(host)) {
    const [owner, repo, ...extra] = path.split('/')
    return owner && repo && !extra.length ? { provider: 'github', host: 'github.com', path: `${owner}/${repo}` } : null
  }
  const gitlab = /^(?:www\.)?(gitlab\.com)(?:-.*)?$/.exec(host)
  if (gitlab || /(?:^|\.)gitlab\./.test(host)) return path.includes('/') ? { provider: 'gitlab', host: gitlab ? gitlab[1] : host, path } : null
  return null
}

// Maps the GitHub payload to what the UI needs, dropping pull requests (GitHub lists them as issues too).
function normalizeIssues(items) {
  return items.filter(item => !item.pull_request).map(item => ({
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    author: item.user?.login || '',
    comments: item.comments || 0,
    createdAt: item.created_at,
    labels: (item.labels || []).map(label => typeof label === 'string' ? { name: label, color: '' } : { name: label.name, color: label.color || '' }),
  }))
}

function normalizeGitlabIssues(items) {
  return items.map(item => ({
    number: item.iid,
    title: item.title,
    state: item.state === 'opened' ? 'open' : 'closed',
    url: item.web_url,
    author: item.author?.username || '',
    comments: item.user_notes_count || 0,
    createdAt: item.created_at,
    labels: (item.labels || []).map(label => typeof label === 'string' ? { name: label, color: '' } : { name: label.name, color: String(label.color || '').replace(/^#/, '') }),
  }))
}

function normalizeGitlabPulls(items) {
  return items.map(item => ({ number: item.iid, title: item.title, state: item.state, draft: item.draft === true || item.work_in_progress === true, url: item.web_url, author: item.author?.username || '', createdAt: item.created_at, head: item.source_branch || '', base: item.target_branch || '', labels: labelsOf(item.labels) }))
}
function normalizeGitlabMilestones(items) {
  return items.map(item => ({ number: item.id, title: item.title, state: item.state === 'active' ? 'open' : 'closed', url: item.web_url, description: item.description || '', dueOn: item.due_date || '', updatedAt: item.updated_at || '', open: null, closed: null }))
}
function normalizeGitlabPipelines(items) {
  const finished = new Set(['success', 'failed', 'canceled', 'skipped', 'manual'])
  return items.map(item => ({ id: item.id, number: item.iid || item.id, name: 'Pipeline', title: item.name || `Pipeline #${item.iid || item.id}`, status: finished.has(item.status) ? 'completed' : 'in_progress', conclusion: ({ failed: 'failure', canceled: 'cancelled' })[item.status] || (finished.has(item.status) ? item.status : ''), branch: item.ref || '', event: item.source || '', url: item.web_url, author: item.user?.username || '', createdAt: item.created_at }))
}

type FetchLike = (url: string, init?: any) => Promise<any>

async function githubToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (env) return env
  try { return (await run('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true })).stdout.trim() } catch { return '' }
}

async function remoteInfo(dir) {
  const remotes = (await git(dir, ['remote'])).split(/\r?\n/).filter(Boolean)
  if (!remotes.length) throw new Error('El repositorio no tiene remotos configurados')
  const seen: string[] = []
  for (const name of [...remotes].sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : 0))) {
    const url = (await git(dir, ['remote', 'get-url', name])).trim()
    const parsed = parseRemote(url)
    if (parsed) return parsed
    seen.push(`${name}: ${url}`)
  }
  throw new Error(`Ningún remoto apunta a GitHub o GitLab (${seen.join(', ')})`)
}

async function fetchJson(fetchImpl: FetchLike, url, headers, hint) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'git-graph-desktop', ...headers } })
  if (response.status === 422) throw new Error('GitHub no pudo procesar la consulta (filtro no válido)')
  if (response.status === 401 || response.status === 404) throw new Error(`No se pudo acceder al repositorio (¿es privado? ${hint})`)
  if (response.status === 403 || response.status === 429) throw new Error(`Acceso denegado o límite de la API alcanzado (${hint})`)
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`)
  return response.json()
}

const labelsOf = labels => (labels || []).map(label => typeof label === 'string' ? { name: label, color: '' } : { name: label.name, color: label.color || '' })

function normalizePulls(items) {
  return items.map(item => ({
    number: item.number,
    title: item.title,
    state: item.merged_at || item.pull_request?.merged_at ? 'merged' : item.state,
    draft: item.draft === true,
    url: item.html_url,
    author: item.user?.login || '',
    createdAt: item.created_at,
    head: item.head?.ref || '',
    base: item.base?.ref || '',
    labels: labelsOf(item.labels),
  }))
}

function normalizeMilestones(items) {
  return items.map(item => ({
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    description: item.description || '',
    dueOn: item.due_on || '',
    updatedAt: item.updated_at || '',
    open: item.open_issues || 0,
    closed: item.closed_issues || 0,
  }))
}

function normalizeRuns(data) {
  return (data?.workflow_runs || []).map(run => ({
    id: run.id,
    number: run.run_number,
    name: run.name || '',
    title: run.display_title || run.name || '',
    status: run.status,
    conclusion: run.conclusion || '',
    branch: run.head_branch || '',
    event: run.event || '',
    url: run.html_url,
    author: run.actor?.login || '',
    createdAt: run.created_at,
  }))
}

const SORTS = { 'created-desc': ['created', 'desc'], 'created-asc': ['created', 'asc'], 'updated-desc': ['updated', 'desc'], 'updated-asc': ['updated', 'asc'], 'comments-desc': ['comments', 'desc'], 'comments-asc': ['comments', 'asc'] }
const RUN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required'])
const PULL_STATUSES = new Set(['draft', 'ready', 'merged'])
const REVIEWS = new Set(['none', 'required', 'approved', 'changes_requested'])
const USER = /^[\w.[\]-]{1,100}$/
const TEXT = value => value.length <= 100 && !/[\u0000-\u001f]/.test(value)
// Allowed filters per section and how each value is validated; unknown keys are dropped, invalid values rejected.
const FILTERS = {
  issues: { author: v => USER.test(v), assignee: v => USER.test(v), label: TEXT, milestone: TEXT, sort: v => Object.hasOwn(SORTS, v) },
  pulls: { author: v => USER.test(v), assignee: v => USER.test(v), label: TEXT, milestone: TEXT, status: v => PULL_STATUSES.has(v), review: v => REVIEWS.has(v), sort: v => Object.hasOwn(SORTS, v) },
  milestones: {},
  runs: { workflow: v => /^\d{1,15}$/.test(v), event: v => /^[a-z_]{1,40}$/.test(v), status: v => RUN_STATUSES.has(v), branch: TEXT, actor: v => USER.test(v) },
}

function cleanFilters(kind, filters) {
  const rules = FILTERS[kind], clean = {}
  for (const [key, value] of Object.entries(filters && typeof filters === 'object' ? filters : {})) {
    if (value === undefined || value === null || value === '') continue
    if (!Object.hasOwn(rules, key)) continue
    if (typeof value !== 'string' || !rules[key](value)) throw new Error('Filtro no válido')
    clean[key] = value
  }
  return clean
}

// GitHub search query equivalent to the UI filters (author:, label:, milestone:, draft:, review:, ...).
function searchUrl(kind, owner, repo, state, filters) {
  const quote = value => `"${value.replace(/"/g, '')}"`
  const parts = [`repo:${owner}/${repo}`, kind === 'pulls' ? 'is:pr' : 'is:issue']
  if (state !== 'all') parts.push(`is:${state}`)
  if (filters.author) parts.push(`author:${filters.author}`)
  if (filters.assignee) parts.push(`assignee:${filters.assignee}`)
  if (filters.label) parts.push(`label:${quote(filters.label)}`)
  if (filters.milestone) parts.push(`milestone:${quote(filters.milestone)}`)
  if (filters.status === 'draft') parts.push('draft:true')
  if (filters.status === 'ready') parts.push('draft:false')
  if (filters.status === 'merged') parts.push('is:merged')
  if (filters.review) parts.push(`review:${filters.review}`)
  const [sort, order] = SORTS[filters.sort || 'created-desc']
  return `https://api.github.com/search/issues?q=${encodeURIComponent(parts.join(' '))}&per_page=100&sort=${sort}&order=${order}`
}

function restUrl(kind, owner, repo, state, filters) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  if (kind === 'runs') {
    const query = ['per_page=50', ...['event', 'status', 'branch', 'actor'].filter(key => filters[key]).map(key => `${key}=${encodeURIComponent(filters[key])}`)]
    return `${base}/actions/${filters.workflow ? `workflows/${filters.workflow}/runs` : 'runs'}?${query.join('&')}`
  }
  if (kind === 'milestones') return `${base}/milestones?state=${state}&per_page=100&sort=due_on`
  return `${base}/${kind === 'pulls' ? 'pulls' : 'issues'}?state=${state}&per_page=100&sort=created&direction=desc`
}

const NORMALIZERS = { issues: normalizeIssues, pulls: normalizePulls, milestones: normalizeMilestones, runs: normalizeRuns }

async function forgeInfo(dir) {
  assertDir(dir)
  const { provider, path } = await remoteInfo(dir)
  return { provider, owner: path.slice(0, path.lastIndexOf('/')), repo: path.slice(path.lastIndexOf('/') + 1) }
}

const githubHeaders = secret => ({ Accept: 'application/vnd.github+json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) })

// `token` (saved for this repository) takes precedence over the environment variables / gh CLI.
async function listResource(dir, kind, { state = 'open', filters }: { state?: string; filters?: any } = {}, fetchImpl: FetchLike = fetch, token = '') {
  assertDir(dir)
  if (!Object.hasOwn(NORMALIZERS, kind)) throw new Error('Sección no válida')
  if (!STATES.has(state)) throw new Error('Estado no válido')
  const clean = cleanFilters(kind, filters)
  const { provider, host, path } = await remoteInfo(dir)
  if (provider === 'gitlab') {
    const secret = token || process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || ''
    const base = `https://${host}/api/v4/projects/${encodeURIComponent(path)}`
    const headers = secret ? { 'PRIVATE-TOKEN': secret } : {}
    const hint = 'añade un token con permiso read_api para este repositorio'
    const endpoint = { issues: 'issues', pulls: 'merge_requests', milestones: 'milestones', runs: 'pipelines' }[kind]
    const stateValue = kind === 'milestones' ? (state === 'open' ? 'active' : state) : (state === 'open' ? 'opened' : state)
    const query = kind === 'runs' ? 'per_page=100' : `state=${stateValue}&per_page=100${kind === 'issues' ? '&order_by=updated_at&with_labels_details=true' : ''}`
    const get = queryString => fetchJson(fetchImpl, `${base}/${endpoint}?${queryString}`, headers, hint)
    let items = await get(query)
    // GitLab distinguishes closed and merged merge requests, while the UI groups both as closed.
    if (kind === 'pulls' && state === 'closed') {
      const merged = await get('state=merged&per_page=100')
      items = [...items, ...merged].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100)
    }
    const normalize = { issues: normalizeGitlabIssues, pulls: normalizeGitlabPulls, milestones: normalizeGitlabMilestones, runs: normalizeGitlabPipelines }[kind]
    return { provider, owner: path.slice(0, path.lastIndexOf('/')), repo: path.slice(path.lastIndexOf('/') + 1), items: normalize(items) }
  }
  const [owner, repo] = path.split('/')
  const secret = token || await githubToken()
  // The list endpoints cannot filter by author/label/...; fall back to the search API only when a non-default filter is set.
  const useSearch = (kind === 'issues' || kind === 'pulls') && Object.entries(clean).some(([key, value]) => !(key === 'sort' && value === 'created-desc'))
  const data = await fetchJson(fetchImpl, useSearch ? searchUrl(kind, owner, repo, state, clean) : restUrl(kind, owner, repo, state, clean), githubHeaders(secret), 'añade un token para este repositorio')
  return { provider, owner, repo, items: NORMALIZERS[kind](useSearch ? data.items || [] : data) }
}

// Options for the filter menus (labels, milestones, people, workflows, branches); a failing lookup just yields an empty list.
async function listFacets(dir, kind, fetchImpl: FetchLike = fetch, token = '') {
  assertDir(dir)
  if (!Object.hasOwn(NORMALIZERS, kind)) throw new Error('Sección no válida')
  const { provider, path } = await remoteInfo(dir)
  const empty = { labels: [], milestones: [], people: [], workflows: [], branches: [] }
  if (provider !== 'github' || kind === 'milestones') return empty
  const [owner, repo] = path.split('/')
  const headers = githubHeaders(token || await githubToken())
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const get = (sub, pick) => fetchJson(fetchImpl, `${base}/${sub}`, headers, '').then(pick, () => [])
  const names = list => list.map(item => ({ value: item.name, label: item.name, color: item.color || '' }))
  const people = get('assignees?per_page=100', list => list.map(user => ({ value: user.login, label: user.login })))
  if (kind === 'runs') {
    const [workflows, branches, who] = await Promise.all([get('actions/workflows?per_page=100', data => (data.workflows || []).map(item => ({ value: String(item.id), label: item.name }))), get('branches?per_page=100', names), people])
    return { ...empty, workflows, branches, people: who }
  }
  const [labels, milestones, who] = await Promise.all([get('labels?per_page=100', names), get('milestones?state=all&per_page=100', list => list.map(item => ({ value: item.title, label: item.title }))), people])
  return { ...empty, labels, milestones, people: who }
}

// Load details using only the configured remote and a validated numeric identifier.
async function resourceDetail(dir, kind, id, fetchImpl: FetchLike = fetch, token = '') {
  assertDir(dir)
  if (!Object.hasOwn(NORMALIZERS, kind)) throw new Error('Sección no válida')
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identificador no válido')
  const { provider, host, path } = await remoteInfo(dir)
  const secret = token || (provider === 'github' ? await githubToken() : process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '')
  const headers = provider === 'github' ? githubHeaders(secret) : (secret ? { 'PRIVATE-TOKEN': secret } : {})
  const base = provider === 'github' ? `https://api.github.com/repos/${path.split('/').map(encodeURIComponent).join('/')}` : `https://${host}/api/v4/projects/${encodeURIComponent(path)}`
  const endpoint = provider === 'gitlab' ? `${({ issues: 'issues', pulls: 'merge_requests', milestones: 'milestones', runs: 'pipelines' })[kind]}/${id}` : kind === 'runs' ? `actions/runs/${id}` : `${kind}/${id}`
  const hint = provider === 'github' ? 'añade un token para este repositorio' : 'añade un token con permiso read_api para este repositorio'
  const item = await fetchJson(fetchImpl, `${base}/${endpoint}`, headers, hint)
  let comments: { author: string; body: string; createdAt: string }[] = [], commentsError = ''
  if (kind === 'issues' || kind === 'pulls') {
    const commentsPath = provider === 'gitlab' ? `${kind === 'pulls' ? 'merge_requests' : 'issues'}/${id}/notes?per_page=100&sort=asc` : `issues/${id}/comments?per_page=100`
    try {
      const entries = await fetchJson(fetchImpl, `${base}/${commentsPath}`, headers, hint)
      comments = entries.filter(entry => !entry.system).map(entry => ({ author: entry.user?.login || entry.author?.username || '', body: entry.body || '', createdAt: entry.created_at || '' }))
    } catch (error) { commentsError = error.message || String(error) }
  }
  return {
    title: item.title || item.display_title || item.name || (kind === 'runs' ? `Pipeline #${item.iid || item.id}` : ''),
    body: item.body || item.description || '',
    url: item.html_url || item.web_url || '',
    state: item.merged_at ? 'merged' : item.state || item.conclusion || item.status || '',
    author: item.user?.login || item.author?.username || item.actor?.login || '',
    createdAt: item.created_at || '', updatedAt: item.updated_at || '',
    labels: labelsOf(item.labels),
    assignees: (item.assignees || []).map(user => user.login || user.username),
    milestone: item.milestone?.title || '',
    head: item.head?.ref || item.head_branch || item.source_branch || item.ref || '', base: item.base?.ref || item.target_branch || '',
    draft: item.draft === true || item.work_in_progress === true, additions: item.additions, deletions: item.deletions, changedFiles: item.changed_files,
    dueOn: item.due_on || item.due_date || '', open: item.open_issues, closed: item.closed_issues,
    event: item.event || item.source || '', status: item.status || '', conclusion: item.conclusion || '',
    comments, commentsError,
  }
}

// Publish a conversation comment to the repository selected by its Git remote.
async function createComment(dir, kind, id, body, fetchImpl: FetchLike = fetch, token = '') {
  assertDir(dir)
  if (kind !== 'issues' && kind !== 'pulls') throw new Error('Sección no válida')
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identificador no válido')
  if (typeof body !== 'string' || !body.trim() || body.length > 65536) throw new Error('Escribe un comentario de hasta 65536 caracteres')
  const { provider, host, path } = await remoteInfo(dir)
  const secret = token || (provider === 'github' ? await githubToken() : process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '')
  if (!secret) throw new Error('Configura un token con permisos de escritura para publicar comentarios')
  const base = provider === 'github' ? `https://api.github.com/repos/${path.split('/').map(encodeURIComponent).join('/')}` : `https://${host}/api/v4/projects/${encodeURIComponent(path)}`
  const headers = provider === 'github' ? githubHeaders(secret) : { 'PRIVATE-TOKEN': secret }
  const response = await fetchImpl(`${base}/${provider === 'gitlab' && kind === 'pulls' ? 'merge_requests' : 'issues'}/${id}/${provider === 'github' ? 'comments' : 'notes'}`, { method: 'POST', headers: { 'User-Agent': 'git-graph-desktop', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ body }) })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new Error('No se pudo publicar el comentario. Comprueba el token y sus permisos de escritura en el repositorio.')
    if (response.status === 422 || response.status === 400) throw new Error('El servidor rechazó el comentario. Comprueba su contenido y los permisos de la conversación.')
    throw new Error(`No se pudo publicar el comentario (HTTP ${response.status})`)
  }
  const comment = await response.json()
  return { author: comment.user?.login || comment.author?.username || '', body: comment.body || body, createdAt: comment.created_at || '' }
}

const listIssues = async (...args) => { const { items, ...rest } = await listResource(args[0], 'issues', ...args.slice(1)); return { ...rest, issues: items } }

export { parseRemote, normalizeIssues, normalizeGitlabIssues, normalizePulls, normalizeMilestones, normalizeRuns, forgeInfo, listResource, listFacets, listIssues, resourceDetail, createComment }
