export function moveProjectTab(projects, sourcePath, targetPath, side) {
  if (sourcePath === targetPath || !['before', 'after'].includes(side)) return projects
  const source = projects.find(project => project.path === sourcePath)
  if (!source || !projects.some(project => project.path === targetPath)) return projects
  const remaining = projects.filter(project => project.path !== sourcePath)
  const index = remaining.findIndex(project => project.path === targetPath)
  remaining.splice(index + (side === 'after' ? 1 : 0), 0, source)
  return remaining
}
