import { errorMessage } from './repo-flow.ts'

export interface SettingAccess {
  value: unknown
  set: (value: any) => void
}

// Optimistic update of one setting: apply it to the UI immediately, persist it, and roll back to the
// previous value if persisting fails. A rollback only happens when no newer change to the same key was
// made meanwhile (tracked in `versions`), so a slow failing save cannot undo a later successful one.
// Returns the error message, or null on success.
export async function applySetting(versions: Record<string, number>, key: string, access: SettingAccess, value: unknown, persist: () => Promise<unknown>): Promise<string | null> {
  const previous = access.value
  const version = (versions[key] || 0) + 1
  versions[key] = version
  access.set(value)
  try {
    await persist()
    return null
  } catch (error) {
    if (versions[key] === version) access.set(previous)
    return errorMessage(error)
  }
}
