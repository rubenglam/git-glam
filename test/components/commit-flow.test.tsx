import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChangesList } from '../../src/components/changes-list.tsx'
import { CommitBox } from '../../src/components/branch-picker.tsx'
import { applyChange } from '../../src/lib/repo-flow.ts'

const ROOT = '/repo'

// In-memory stand-in for the desktop host: just enough git semantics for stage → commit → history.
function fakeGitGraph(options: { pushFails?: boolean } = {}) {
  const state = {
    commits: [{ hash: 'c1', subject: 'init' }],
    changes: [{ path: 'a.txt', status: '??' }, { path: 'b.txt', status: ' M' }],
    messages: [] as string[],
  }
  const staged = (status: string) => status[0] !== ' ' && status[0] !== '?'
  const commit = async (_dir: string, message: string, { amend }: { amend: boolean }) => {
    if (!amend && !state.changes.some(change => staged(change.status))) throw new Error('nada que confirmar')
    state.changes = state.changes.filter(change => !staged(change.status))
    const entry = { hash: 'c' + (state.commits.length + 1), subject: message || state.commits[0].subject }
    state.commits = amend ? [entry, ...state.commits.slice(1)] : [entry, ...state.commits]
    state.messages.push(message)
  }
  return {
    state,
    stage: async (_dir: string, paths: string[]) => { state.changes = state.changes.map(change => paths.includes(change.path) ? { ...change, status: 'A ' } : change) },
    unstage: async (_dir: string, paths: string[]) => { state.changes = state.changes.map(change => paths.includes(change.path) ? { ...change, status: '??' } : change) },
    commit,
    commitAndPush: async (dir: string, message: string, options_: { amend: boolean }) => {
      await commit(dir, message, options_)
      if (options.pushFails) throw new Error('El commit se creó, pero el push falló: rechazado')
    },
    lastMessage: async () => state.commits[0].subject,
    cancelCommitMessage: async () => {},
    load: async (root: string) => ({ root, commits: [...state.commits], changes: [...state.changes] }),
  }
}

// Wires the real ChangesList and CommitBox the same way App does, minus the unrelated panels.
function SourceControl({ git }: { git: ReturnType<typeof fakeGitGraph> }) {
  const [repo, setRepo] = useState<any>({ root: ROOT, commits: [...git.state.commits], changes: [...git.state.changes] })
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const reload = async () => { setError(''); setRepo(await git.load(ROOT)) }
  const change = (task: (root: string) => Promise<unknown>) => applyChange(ROOT, task, reload).then(failure => { if (failure) setError(failure) })
  return <>
    <CommitBox showAICommit={false} dir={ROOT} sync={undefined} syncing={false} onSync={() => {}} changes={repo.changes} publishedTo={null} disabled={false} onError={setError}
      onCommitted={async (_amended, pushed) => { await reload(); setNotice(pushed ? 'Commit creado y enviado' : 'Commit creado') }}/>
    <ChangesList changes={repo.changes} selected={null} busy={false} onPick={() => {}} onContext={() => {}} onReview={undefined} onDiscard={undefined as any}
      onStage={paths => change(root => git.stage(root, paths))} onUnstage={paths => change(root => git.unstage(root, paths))}/>
    <ol aria-label="Historial">{repo.commits.map((commit: any) => <li key={commit.hash}>{commit.subject}</li>)}</ol>
    {notice && <div role="status">{notice}</div>}
    {error && <div role="alert">{error}</div>}
  </>
}

function setup(options?: Parameters<typeof fakeGitGraph>[0]) {
  const git = fakeGitGraph(options)
  ;(window as any).gitGraph = git
  const user = userEvent.setup()
  render(<SourceControl git={git}/>)
  return { git, user }
}

const history = () => screen.getAllByRole('listitem').map(item => item.textContent)

describe('stage → commit → history', () => {
  it('commits the staged file and refreshes history and working tree', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: 'Confirmar todo' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Preparar: a.txt' }))
    expect(await screen.findByRole('button', { name: 'Quitar del área de preparación: a.txt' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Mensaje de commit' }), 'añade a.txt')
    await user.click(screen.getByRole('button', { name: 'Confirmar cambios preparados' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Commit creado')
    expect(history()).toEqual(['añade a.txt', 'init'])
    expect(screen.queryByRole('button', { name: /a\.txt/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preparar: b.txt' }), 'the untouched change stays pending').toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensaje de commit' })).toHaveValue('')
  })

  it('does not commit an empty message and Ctrl+Enter commits a valid one', async () => {
    const { git, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Preparar: b.txt' }))
    const commit = await screen.findByRole('button', { name: 'Confirmar cambios preparados' })
    expect(commit).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Mensaje de commit' }), 'fix b{Control>}{Enter}{/Control}')
    await waitFor(() => expect(git.state.messages).toEqual(['fix b']))
    expect(history()[0]).toBe('fix b')
  })

  it('keeps the draft message per repository until the commit succeeds', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Mensaje de commit' }), 'borrador')
    expect(localStorage.getItem(`gitgraph.commitDraft:${ROOT}`)).toBe('borrador')

    await user.click(screen.getByRole('button', { name: 'Preparar: a.txt' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar cambios preparados' }))
    await screen.findByRole('status')
    expect(localStorage.getItem(`gitgraph.commitDraft:${ROOT}`)).toBeNull()
  })

  it('commit and push: a rejected push still shows the new commit and surfaces the error', async () => {
    const { user } = setup({ pushFails: true })
    await user.click(screen.getByRole('button', { name: 'Preparar: b.txt' }))
    await user.type(screen.getByRole('textbox', { name: 'Mensaje de commit' }), 'fix b')
    await user.click(await screen.findByRole('button', { name: 'Confirmar y hacer push' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('push falló')
    expect(history()).toEqual(['fix b', 'init'])
    expect(screen.getByRole('status'), 'the commit is reported, but not as pushed').toHaveTextContent(/^Commit creado$/)
  })

  it('amend pre-fills the last message and replaces the last commit', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('checkbox', { name: /Enmendar el último commit/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mensaje de commit' })).toHaveValue('init'))

    await user.clear(screen.getByRole('textbox', { name: 'Mensaje de commit' }))
    await user.type(screen.getByRole('textbox', { name: 'Mensaje de commit' }), 'init (corregido)')
    await user.click(screen.getByRole('button', { name: 'Enmendar commit' }))

    await screen.findByRole('status')
    expect(history()).toEqual(['init (corregido)'])
  })
})
