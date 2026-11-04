// Builds a folder tree from changed files and merges single-child folder chains ("apps / frontend / src").
interface TreeBuild { dirs: Map<string, TreeBuild>; files: any[] }

export function buildFileTree(files: { path: string }[]) {
  const root: TreeBuild = { dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/'), name = parts.pop()
    let node = root
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push({ ...file, name })
  }
  const toList = node => [
    ...[...node.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      let label = name
      while (child.dirs.size === 1 && child.files.length === 0) {
        const [[next, nested]] = child.dirs
        label += ' / ' + next; child = nested
      }
      return { type: 'dir', label, children: toList(child) }
    }),
    ...node.files.sort((a, b) => a.name.localeCompare(b.name)).map(file => ({ type: 'file', ...file })),
  ]
  return toList(root)
}
