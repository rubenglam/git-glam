export type Bump = 'patch' | 'minor' | 'major'

export interface VersionOption { bump: Bump; version: string; label: string; hint: string; recommended: boolean }

export const isVersion = (value: string) => /^\d+\.\d+\.\d+$/.test(value)

export function bumpVersion(current: string, bump: Bump) {
  const [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Compares two x.y.z versions: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}

/** Mirrors scripts/release.ts: feat → minor, breaking → major, anything else → patch. */
export function recommendedBump(commits: string[]): Bump {
  let bump: Bump = 'patch'
  for (const subject of commits) {
    const match = subject.match(/^([a-z]+)(?:\([^)]*\))?(!)?:/i)
    if (match?.[2] || /BREAKING CHANGE/.test(subject)) return 'major'
    if (match?.[1].toLowerCase() === 'feat') bump = 'minor'
  }
  return bump
}

export function versionOptions(current: string, commits: string[]): VersionOption[] {
  const recommended = recommendedBump(commits)
  const hints: Record<Bump, string> = { patch: 'Correcciones y ajustes', minor: 'Funciones nuevas', major: 'Cambios incompatibles' }
  return (['patch', 'minor', 'major'] as const).map(bump => ({
    bump, version: bumpVersion(current, bump), hint: hints[bump], recommended: bump === recommended,
    label: bump === 'patch' ? 'Parche' : bump === 'minor' ? 'Menor' : 'Mayor',
  }))
}
