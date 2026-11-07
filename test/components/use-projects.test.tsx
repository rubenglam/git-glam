import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useProjects } from '../../src/hooks/use-projects.ts'

const p = (path: string, folderId?: string) => ({ path, folderId })

function setup(overrides: Record<string, any> = {}, groupTabs = false) {
  const api = {
    status: vi.fn(async () => ({})),
    reorder: vi.fn(async (paths: string[]) => ({ projects: paths.map(path => p(path)) })),
    reorderFolders: vi.fn(async (ids: string[]) => ({ folders: ids.map(id => ({ id })) })),
    move: vi.fn(async (path: string, folderId: string | null) => ({ projects: [p(path, folderId ?? undefined)], folders: [{ id: 'f' }] })),
    setDefault: vi.fn(async (path: string | null) => ({ defaultProject: path })),
    ...overrides,
  }
  ;(window as any).gitGraph = { projects: api }
  const setBusy = vi.fn(), setError = vi.fn()
  const hook = renderHook(props => useProjects({ setBusy, setError, groupTabs: props.groupTabs, repoVersion: null }), { initialProps: { groupTabs } })
  act(() => { hook.result.current.setProjects([p('a'), p('b'), p('c')]) })
  return { ...hook, api, setBusy, setError }
}

describe('useProjects', () => {
  it('reorders optimistically and keeps the server state on success', async () => {
    const { result, api, setBusy } = setup()
    let pending: Promise<void>
    act(() => { pending = result.current.reorderTabs([p('c'), p('a'), p('b')]) })
    expect(result.current.projects.map(x => x.path), 'shown before the host answers').toEqual(['c', 'a', 'b'])
    await act(async () => { await pending })
    expect(api.reorder).toHaveBeenCalledWith(['c', 'a', 'b'])
    expect(setBusy.mock.calls.map(c => c[0])).toEqual([true, false])
  })

  it('rolls the order back and reports the error when the host rejects it', async () => {
    const { result, setError } = setup({ reorder: vi.fn(async () => { throw new Error('disco lleno') }) })
    await act(async () => { await result.current.reorderTabs([p('b'), p('a'), p('c')]) })
    expect(result.current.projects.map(x => x.path)).toEqual(['a', 'b', 'c'])
    expect(setError).toHaveBeenLastCalledWith('disco lleno')
  })

  it('does not call the host when the order did not change', async () => {
    const { result, api } = setup()
    await act(async () => { await result.current.reorderTabs([p('a'), p('b'), p('c')]) })
    expect(api.reorder).not.toHaveBeenCalled()
  })

  it('hidden tabs keep their slot when the visible ones are reordered', async () => {
    const { result, api } = setup()
    act(() => { result.current.hideTab('b') })
    expect(result.current.visibleProjects.map(x => x.path)).toEqual(['a', 'c'])
    await act(async () => { await result.current.reorderTabs([p('c'), p('a')]) })
    expect(api.reorder).toHaveBeenCalledWith(['c', 'b', 'a'])
  })

  it('hiding the active tab returns to the projects page; opening it later reveals it again', async () => {
    const { result } = setup()
    act(() => { result.current.setActiveProject('a'); result.current.setShowProjects(false) })
    act(() => { result.current.hideTab('a') })
    expect(result.current.showProjects).toBe(true)
    expect(result.current.visibleProjects.map(x => x.path)).toEqual(['b', 'c'])

    act(() => { result.current.setShowProjects(false) })
    await waitFor(() => expect(result.current.visibleProjects.map(x => x.path)).toEqual(['a', 'b', 'c']))
  })

  it('hiding a folder only affects tabs while they are grouped', () => {
    const { result, rerender } = setup({}, false)
    act(() => { result.current.setProjects([p('a', 'f'), p('b')]); result.current.hideFolder('f') })
    expect(result.current.visibleProjects.map(x => x.path)).toEqual(['a', 'b'])
    rerender({ groupTabs: true })
    expect(result.current.visibleProjects.map(x => x.path)).toEqual(['b'])
  })

  it('toggling the default project sets it, then clears it', async () => {
    const { result, api } = setup()
    await act(async () => { await result.current.toggleDefault('a') })
    expect(result.current.defaultProject).toBe('a')
    await act(async () => { await result.current.toggleDefault('a') })
    expect(api.setDefault).toHaveBeenLastCalledWith(null)
    expect(result.current.defaultProject).toBeNull()
  })

  it('moving a tab to a folder updates folders and projects, and failures surface as errors', async () => {
    const ok = setup()
    await act(async () => { await ok.result.current.moveTab('a', 'f', null, 'after') })
    expect(ok.result.current.projects).toEqual([p('a', 'f')])
    expect(ok.result.current.folders).toEqual([{ id: 'f' }])

    const bad = setup({ move: vi.fn(async () => { throw new Error('carpeta inexistente') }) })
    await act(async () => { await bad.result.current.moveTab('a', 'x', null, 'after') })
    expect(bad.setError).toHaveBeenLastCalledWith('carpeta inexistente')
    expect(bad.result.current.projects.map(x => x.path)).toEqual(['a', 'b', 'c'])
  })

  it('saving appearance merges the patch into the stored fields', async () => {
    const setAppearance = vi.fn(async () => ({ projects: [p('a')] }))
    const { result } = setup({ setAppearance })
    act(() => { result.current.setProjects([{ path: 'a', name: 'Alfa', icon: 'x', color: '#fff' }]) })
    await act(async () => { await result.current.saveAppearance('a', { color: null }) })
    expect(setAppearance).toHaveBeenCalledWith('a', { name: 'Alfa', icon: 'x', color: null, colorTargets: undefined })
  })
})
