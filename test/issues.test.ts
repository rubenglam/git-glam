import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseRemote, normalizeIssues, normalizeGitlabIssues, normalizePulls, normalizeMilestones, normalizeRuns, forgeInfo, listResource, listFacets, listIssues, resourceDetail, createComment } from '../electron/issues.ts'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('parseRemote understands github and gitlab urls', () => {
  const github = { provider: 'github', host: 'github.com', path: 'me/app' }
  for (const url of ['https://github.com/me/app.git', 'https://github.com/me/app', 'https://user@github.com/me/app.git', 'git@github.com:me/app.git', 'ssh://git@github.com/me/app.git', 'git@github.com-work:me/app.git', 'https://ghp_x:y@github.com/me/app.git', 'ssh://git@ssh.github.com:443/me/app.git']) assert.deepEqual(parseRemote(url), github, url)
  assert.deepEqual(parseRemote('https://gitlab.com/steema/visamic/visamic.git'), { provider: 'gitlab', host: 'gitlab.com', path: 'steema/visamic/visamic' })
  assert.deepEqual(parseRemote('git@gitlab.com-work:grp/app.git'), { provider: 'gitlab', host: 'gitlab.com', path: 'grp/app' })
  assert.deepEqual(parseRemote('https://gitlab.example.org/a/b.git'), { provider: 'gitlab', host: 'gitlab.example.org', path: 'a/b' })
  assert.equal(parseRemote('https://bitbucket.org/me/app.git'), null)
  assert.equal(parseRemote('C:/repos/app'), null)
})

test('normalizeIssues drops pull requests and maps fields', () => {
  const [issue, ...rest] = normalizeIssues([
    { number: 1, title: 'Bug', state: 'open', html_url: 'u1', user: { login: 'a' }, comments: 2, created_at: 'd', labels: [{ name: 'bug', color: 'f00' }, 'x'] },
    { number: 2, title: 'PR', pull_request: {} },
  ])
  assert.equal(rest.length, 0)
  assert.deepEqual(issue, { number: 1, title: 'Bug', state: 'open', url: 'u1', author: 'a', comments: 2, createdAt: 'd', labels: [{ name: 'bug', color: 'f00' }, { name: 'x', color: '' }] })
})

test('normalizeGitlabIssues maps fields', () => {
  assert.deepEqual(normalizeGitlabIssues([{ iid: 7, title: 'T', state: 'closed', web_url: 'u', author: { username: 'a' }, user_notes_count: 3, created_at: 'd', labels: [{ name: 'bug', color: '#ff0000' }, 'x'] }]),
    [{ number: 7, title: 'T', state: 'closed', url: 'u', author: 'a', comments: 3, createdAt: 'd', labels: [{ name: 'bug', color: 'ff0000' }, { name: 'x', color: '' }] }])
})

test('listIssues picks the provider from the remote and calls its API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-issues-'))
  git(dir, 'init', '-b', 'main')
  await assert.rejects(listIssues(dir), /no tiene remotos/)
  git(dir, 'remote', 'add', 'origin', 'https://example.com/x/y.git')
  await assert.rejects(listIssues(dir), /GitHub o GitLab/)
  git(dir, 'remote', 'add', 'gh', 'git@github.com:me/app.git')
  let requested
  const github = async (url: string) => { requested = url; return { ok: true, status: 200, json: async () => [{ number: 3, title: 'T', state: 'open', html_url: 'u' }] } }
  const result = await listIssues(dir, { state: 'all' }, github)
  assert.match(requested, /repos\/me\/app\/issues\?state=all/)
  assert.equal(result.owner, 'me'); assert.equal(result.issues[0].number, 3)
  await assert.rejects(listIssues(dir, { state: 'bogus' }), /Estado/)
  await assert.rejects(listIssues(dir, {}, async () => ({ ok: false, status: 404 })), /No se pudo acceder/)

  git(dir, 'remote', 'remove', 'gh')
  git(dir, 'remote', 'add', 'gl', 'https://gitlab.com/g/sub/p.git')
  const gitlab = async (url: string) => { requested = url; return { ok: true, status: 200, json: async () => [{ iid: 1, title: 'G', state: 'opened', web_url: 'w' }] } }
  const glResult = await listIssues(dir, { state: 'open' }, gitlab)
  assert.match(requested, /^https:\/\/gitlab\.com\/api\/v4\/projects\/g%2Fsub%2Fp\/issues\?state=opened/)
  assert.equal(glResult.issues[0].state, 'open'); assert.equal(glResult.repo, 'p'); assert.equal(glResult.owner, 'g/sub')
})

test('normalizePulls, normalizeMilestones and normalizeRuns map GitHub payloads', () => {
  const pulls = normalizePulls([
    { number: 1, title: 'A', state: 'closed', merged_at: 'm', html_url: 'u', user: { login: 'x' }, created_at: 'd', head: { ref: 'f' }, base: { ref: 'main' }, labels: [{ name: 'l', color: 'fff' }] },
    { number: 2, title: 'B', state: 'open', draft: true, html_url: 'u2', head: {}, base: {} },
  ])
  assert.deepEqual(pulls.map(p => [p.state, p.draft, p.head, p.base]), [['merged', false, 'f', 'main'], ['open', true, '', '']])
  assert.deepEqual(normalizeMilestones([{ number: 4, title: 'v1', state: 'open', html_url: 'u', due_on: '2026-01-01', updated_at: 'up', open_issues: 2, closed_issues: 3 }]),
    [{ number: 4, title: 'v1', state: 'open', url: 'u', description: '', dueOn: '2026-01-01', updatedAt: 'up', open: 2, closed: 3 }])
  assert.deepEqual(normalizeRuns({ workflow_runs: [{ id: 9, run_number: 5, name: 'CI', display_title: 'Fix', status: 'completed', conclusion: 'success', head_branch: 'main', event: 'push', html_url: 'u', actor: { login: 'a' }, created_at: 'd' }] }),
    [{ id: 9, number: 5, name: 'CI', title: 'Fix', status: 'completed', conclusion: 'success', branch: 'main', event: 'push', url: 'u', author: 'a', createdAt: 'd' }])
  assert.deepEqual(normalizeRuns(undefined), [])
})

test('listResource calls the provider endpoint for each section', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-forge-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'remote', 'add', 'origin', 'git@github.com:me/app.git')
  assert.deepEqual(await forgeInfo(dir), { provider: 'github', owner: 'me', repo: 'app' })
  const urls: string[] = []
  const fetchImpl = async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => url.includes('/actions/runs') ? { workflow_runs: [] } : [] } }
  for (const kind of ['issues', 'pulls', 'milestones', 'runs']) assert.deepEqual((await listResource(dir, kind, { state: 'closed' }, fetchImpl, 'tok')).items, [])
  assert.match(urls[1], /repos\/me\/app\/pulls\?state=closed/)
  assert.match(urls[2], /repos\/me\/app\/milestones\?state=closed/)
  assert.match(urls[3], /repos\/me\/app\/actions\/runs\?per_page=50/)
  await assert.rejects(listResource(dir, 'nope', {}, fetchImpl), /Sección/)
  git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/g/p.git')
  assert.equal((await forgeInfo(dir)).provider, 'gitlab')
  for (const kind of ['pulls', 'milestones', 'runs']) assert.deepEqual((await listResource(dir, kind, {}, fetchImpl, 'tok')).items, [])
  assert.match(urls[4], /projects\/g%2Fp\/merge_requests\?state=opened/); assert.match(urls[5], /milestones\?state=active/); assert.match(urls[6], /pipelines\?per_page=100/)
})

test('filters use the search API for issues and pulls, and query parameters for runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-filters-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'remote', 'add', 'origin', 'https://github.com/me/app.git')
  const urls: string[] = []
  const fetchImpl = async (url: string) => { urls.push(decodeURIComponent(url)); return { ok: true, status: 200, json: async () => url.includes('/search/') ? { items: [{ number: 1, title: 'P', state: 'closed', pull_request: { merged_at: 'm' }, html_url: 'u' }] } : url.includes('/actions/') ? { workflow_runs: [] } : [] } }
  const pulls = await listResource(dir, 'pulls', { state: 'closed', filters: { author: 'ana', label: 'bug "x"', milestone: 'v1', status: 'draft', review: 'approved', sort: 'comments-desc', ignored: 'x' } }, fetchImpl)
  assert.equal(pulls.items[0].state, 'merged')
  assert.match(urls[0], /^https:\/\/api\.github\.com\/search\/issues\?q=repo:me\/app is:pr is:closed author:ana label:"bug x" milestone:"v1" draft:true review:approved&per_page=100&sort=comments&order=desc$/)
  await listResource(dir, 'issues', { filters: { sort: 'created-desc', author: '' } }, fetchImpl)
  assert.match(urls[1], /\/repos\/me\/app\/issues\?state=open/)
  await listResource(dir, 'issues', { state: 'all', filters: { assignee: 'bob' } }, fetchImpl)
  assert.match(urls[2], /search\/issues\?q=repo:me\/app is:issue assignee:bob&/)
  await listResource(dir, 'runs', { filters: { workflow: '12', event: 'push', status: 'failure', branch: 'feat/x', actor: 'ana' } }, fetchImpl)
  assert.match(urls[3], /\/actions\/workflows\/12\/runs\?per_page=50&event=push&status=failure&branch=feat\/x&actor=ana$/)
  for (const [kind, filters] of [['issues', { author: 'a b' }], ['issues', { sort: 'bogus' }], ['pulls', { review: 'x' }], ['runs', { workflow: 'abc' }], ['runs', { status: 'weird' }]]) await assert.rejects(listResource(dir, kind, { filters }, fetchImpl), /Filtro no válido/, kind + JSON.stringify(filters))
  assert.equal(urls.length, 4)
})

test('listFacets returns menu options and tolerates failing lookups', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-facets-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'remote', 'add', 'origin', 'https://github.com/me/app.git')
  const fetchImpl = async (url: string) => {
    if (url.includes('/branches')) return { ok: false, status: 500 }
    const body = url.includes('/labels') ? [{ name: 'bug', color: 'f00' }] : url.includes('/milestones') ? [{ title: 'v1' }] : url.includes('/assignees') ? [{ login: 'ana' }] : { workflows: [{ id: 7, name: 'CI' }] }
    return { ok: true, status: 200, json: async () => body }
  }
  assert.deepEqual(await listFacets(dir, 'issues', fetchImpl, 't'), { labels: [{ value: 'bug', label: 'bug', color: 'f00' }], milestones: [{ value: 'v1', label: 'v1' }], people: [{ value: 'ana', label: 'ana' }], workflows: [], branches: [] })
  const runs = await listFacets(dir, 'runs', fetchImpl, 't')
  assert.deepEqual([runs.workflows, runs.branches, runs.people], [[{ value: '7', label: 'CI' }], [], [{ value: 'ana', label: 'ana' }]])
  assert.deepEqual((await listFacets(dir, 'milestones', fetchImpl, 't')).labels, [])
})

test('resourceDetail loads GitHub PR details and conversation with repository credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-detail-'))
  git(dir, 'init'); git(dir, 'remote', 'add', 'origin', 'git@github.com:me/app.git')
  const calls: any[] = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => url.includes('/comments?') ? [{ user: { login: 'bob' }, body: 'Hello' }] : { title: 'Fix', body: 'Description', html_url: 'https://github.com/me/app/pull/4', head: { ref: 'feature' }, base: { ref: 'main' }, additions: 3 } } }
  const detail = await resourceDetail(dir, 'pulls', 4, fetchImpl, 'secret')
  assert.match(calls[0].url, /\/repos\/me\/app\/pulls\/4$/)
  assert.match(calls[1].url, /\/issues\/4\/comments\?/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret')
  assert.equal(detail.body, 'Description'); assert.equal(detail.head, 'feature'); assert.equal(detail.comments[0].author, 'bob')
  await assert.rejects(resourceDetail(dir, 'pulls', -1, fetchImpl), /Identificador/)
  await assert.rejects(resourceDetail(dir, 'other', 1, fetchImpl), /Sección/)
})

test('resourceDetail loads GitLab notes and preserves details if comments fail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-detail-'))
  git(dir, 'init'); git(dir, 'remote', 'add', 'origin', 'https://gitlab.com/group/sub/app.git')
  const calls: any[] = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return url.includes('/notes?') ? { ok: false, status: 403 } : { ok: true, status: 200, json: async () => ({ title: 'Issue', description: 'Text', author: { username: 'ana' } }) } }
  const detail = await resourceDetail(dir, 'issues', 7, fetchImpl, 'secret')
  assert.match(calls[0].url, /projects\/group%2Fsub%2Fapp\/issues\/7$/)
  assert.equal(calls[0].init.headers['PRIVATE-TOKEN'], 'secret')
  assert.equal(detail.body, 'Text'); assert.equal(detail.author, 'ana'); assert.match(detail.commentsError, /Acceso denegado/)
})



test('createComment publishes to GitHub and GitLab with the selected credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-comment-'))
  git(dir, 'init'); git(dir, 'remote', 'add', 'origin', 'https://github.com/me/app.git')
  const calls: any[] = []
  const send = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ body: 'Hola', user: { login: 'ana' }, author: { username: 'ana' } }) } }
  const comment = await createComment(dir, 'pulls', 12, 'Hola', send, 'secret')
  assert.equal(comment.author, 'ana'); assert.match(calls[0].url, /repos\/me\/app\/issues\/12\/comments$/)
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers.Authorization, 'Bearer secret'); assert.deepEqual(JSON.parse(calls[0].init.body), { body: 'Hola' })
  await assert.rejects(createComment(dir, 'issues', 1, '   ', send, 'secret'), /comentario/)
  await assert.rejects(createComment(dir, 'runs', 1, 'x', send, 'secret'), /Sección/)
  await assert.rejects(createComment(dir, 'issues', 1, 'x', async () => ({ ok: false, status: 403 }), 'secret'), /permisos de escritura/)
  git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/group/sub/app.git')
  await createComment(dir, 'issues', 8, 'Hola', send, 'gl-secret')
  assert.match(calls[1].url, /projects\/group%2Fsub%2Fapp\/issues\/8\/notes$/); assert.equal(calls[1].init.headers['PRIVATE-TOKEN'], 'gl-secret')
})


test('GitLab merge requests, milestones and pipelines list and detail map their API fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-graph-gitlab-'))
  git(dir, 'init'); git(dir, 'remote', 'add', 'origin', 'https://gitlab.com/group/sub/app.git')
  const calls: any[] = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    let data: any = []
    if (/merge_requests\?state=closed/.test(url)) data = [{ iid: 4, title: 'Closed', state: 'closed', created_at: '2026-01-01' }]
    else if (/merge_requests\?state=merged/.test(url)) data = [{ iid: 5, title: 'Merged', state: 'merged', source_branch: 'feature', target_branch: 'main', draft: true, created_at: '2026-02-01' }]
    else if (/milestones\?/.test(url)) data = [{ id: 21, iid: 2, title: 'Release', state: 'active', due_date: '2026-12-01' }]
    else if (/pipelines\?/.test(url)) data = [{ id: 31, iid: 3, status: 'failed', ref: 'main', web_url: 'https://gitlab.com/pipeline' }]
    else if (/merge_requests\/5\/notes/.test(url)) data = [{ author: { username: 'ana' }, body: 'Comment' }, { system: true }]
    else if (/merge_requests\/5$/.test(url)) data = { iid: 5, title: 'Merged', state: 'merged', description: 'Details', source_branch: 'feature', target_branch: 'main' }
    else if (/milestones\/21$/.test(url)) data = { id: 21, title: 'Release', due_date: '2026-12-01' }
    else if (/pipelines\/31$/.test(url)) data = { id: 31, iid: 3, status: 'failed', ref: 'main', source: 'push' }
    return { ok: true, status: 200, json: async () => data }
  }
  const pulls = (await listResource(dir, 'pulls', { state: 'closed' }, fetchImpl, 't')).items
  assert.deepEqual(pulls.map(item => item.state), ['merged', 'closed']); assert.equal(pulls[0].head, 'feature'); assert.equal(pulls[0].draft, true)
  const milestones = (await listResource(dir, 'milestones', {}, fetchImpl, 't')).items
  assert.equal(milestones[0].number, 21); assert.equal(milestones[0].open, null)
  const runs = (await listResource(dir, 'runs', {}, fetchImpl, 't')).items
  assert.equal(runs[0].conclusion, 'failure'); assert.equal(runs[0].status, 'completed')
  const mr = await resourceDetail(dir, 'pulls', 5, fetchImpl, 't')
  assert.equal(mr.body, 'Details'); assert.equal(mr.base, 'main'); assert.equal(mr.comments.length, 1)
  assert.equal((await resourceDetail(dir, 'milestones', 21, fetchImpl, 't')).dueOn, '2026-12-01')
  assert.equal((await resourceDetail(dir, 'runs', 31, fetchImpl, 't')).head, 'main')
  const post = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ body: 'Hello', author: { username: 'ana' } }) } }
  await createComment(dir, 'pulls', 5, 'Hello', post, 't')
  assert.match(calls.at(-1).url, /merge_requests\/5\/notes$/)
})
