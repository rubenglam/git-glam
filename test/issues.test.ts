import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseRemote, normalizeIssues, normalizeGitlabIssues, normalizePulls, normalizeMilestones, normalizeRuns, forgeInfo, listResource, listFacets, listIssues } from '../electron/issues.ts'
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

test('listResource calls the GitHub endpoint of each section and keeps GitLab to issues', async () => {
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
  await assert.rejects(listResource(dir, 'pulls', {}, fetchImpl), /solo está disponible para GitHub/)
  assert.equal(urls.length, 4)
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
