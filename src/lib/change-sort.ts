// Letter shown for a change in the given area: index status when staged, work-tree status otherwise ("U" for untracked).
import type { FileChange } from '../types.ts'

export const statusLetter = (change: FileChange, staged?: boolean) => staged ? change.status[0] : change.status === '??' ? 'U' : change.status[1]

const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path)
const baseName = (change: FileChange) => change.path.slice(change.path.lastIndexOf('/') + 1)

export function sortChanges(changes: FileChange[], mode: string, staged?: boolean) {
  const compare: (a: FileChange, b: FileChange) => number = mode === 'name' ? (a, b) => baseName(a).localeCompare(baseName(b)) || byPath(a, b)
    : mode === 'status' ? (a, b) => statusLetter(a, staged).localeCompare(statusLetter(b, staged)) || byPath(a, b)
    : byPath
  return [...changes].sort(compare)
}
