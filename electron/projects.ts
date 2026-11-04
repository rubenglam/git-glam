import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const empty = () => ({ projects: [], folders: [], activeProject: null, defaultProject: null })
const key = value => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
const folderName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('El nombre debe tener entre 1 y 80 caracteres')
  return value.trim()
}
const assertUniqueFolder = (folders, name, except: string | null = null) => {
  if (folders.some(folder => folder.id !== except && folder.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) throw new Error('Ya existe una carpeta con ese nombre')
}

function createProjectStore(file) {
  let state
  let queue = Promise.resolve()
  async function read() {
    if (state) return state
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!Array.isArray(parsed.projects) || !parsed.projects.every(p => p && typeof p.path === 'string' && typeof p.lastWorktree === 'string' && (p.command === undefined || typeof p.command === 'string')) || !(parsed.activeProject === null || typeof parsed.activeProject === 'string')) throw new Error('Formato de proyectos no válido')
      if (parsed.defaultProject !== undefined && parsed.defaultProject !== null && typeof parsed.defaultProject !== 'string') throw new Error('Proyecto predeterminado no válido')
      const folders = parsed.folders ?? []
      if (!Array.isArray(folders) || !folders.every(folder => folder && typeof folder.id === 'string' && typeof folder.name === 'string') || !parsed.projects.every(project => project.folderId == null || typeof project.folderId === 'string')) throw new Error('Formato de carpetas no válido')
      state = { ...parsed, folders, defaultProject: parsed.defaultProject ?? null }
    } catch (error) {
      if (error.code === 'ENOENT') state = empty()
      else throw new Error(`No se pudo leer la lista de proyectos: ${error.message}`)
    }
    return state
  }
  function update(fn) {
    const operation = queue.then(async () => {
      const current = await read()
      const next = fn(current)
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
        await fs.rename(temporary, file)
      } catch (error) {
        await fs.unlink(temporary).catch(() => {})
        throw new Error(`No se pudo guardar la lista de proyectos: ${error.message}`)
      }
      state = next
      return next
    })
    queue = operation.catch(() => {})
    return operation
  }
  return {
    list: async () => { await queue; return read() },
    add: root => update(current => {
      const existing = current.projects.find(p => key(p.path) === key(root))
      return { ...current, projects: existing ? current.projects.map(p => key(p.path) === key(root) ? { ...p, path: root, lastWorktree: root } : p) : [{ path: root, lastWorktree: root }, ...current.projects], activeProject: root }
    }),
    activate: (project, worktree) => update(current => {
      if (!current.projects.some(p => key(p.path) === key(project))) throw new Error('El proyecto ya no está en la lista')
      return { ...current, projects: current.projects.map(p => key(p.path) === key(project) ? { ...p, lastWorktree: worktree } : p), activeProject: project }
    }),
    select: project => update(current => {
      const entry = current.projects.find(p => key(p.path) === key(project))
      if (!entry) throw new Error('El proyecto ya no está en la lista')
      return { ...current, activeProject: entry.path }
    }),
    setDefault: project => update(current => {
      if (project !== null && !current.projects.some(p => key(p.path) === key(project))) throw new Error('El proyecto ya no está en la lista')
      return { ...current, defaultProject: project === null ? null : current.projects.find(p => key(p.path) === key(project)).path }
    }),
    createFolder: name => update(current => {
      name = folderName(name); assertUniqueFolder(current.folders, name)
      return { ...current, folders: [...current.folders, { id: crypto.randomUUID(), name }] }
    }),
    renameFolder: (id, name) => update(current => {
      if (typeof id !== 'string' || !current.folders.some(folder => folder.id === id)) throw new Error('La carpeta ya no existe')
      name = folderName(name); assertUniqueFolder(current.folders, name, id)
      return { ...current, folders: current.folders.map(folder => folder.id === id ? { ...folder, name } : folder) }
    }),
    deleteFolder: id => update(current => {
      if (typeof id !== 'string' || !current.folders.some(folder => folder.id === id)) throw new Error('La carpeta ya no existe')
      return { ...current, folders: current.folders.filter(folder => folder.id !== id), projects: current.projects.map(project => project.folderId === id ? { ...project, folderId: null } : project) }
    }),
    reorderFolders: ids => update(current => {
      if (!Array.isArray(ids) || ids.length !== current.folders.length || new Set(ids).size !== ids.length) throw new Error('El orden de carpetas no es válido')
      const byId = new Map(current.folders.map(folder => [folder.id, folder]))
      const ordered = ids.map(id => byId.get(id))
      if (ordered.some(folder => !folder)) throw new Error('La lista de carpetas ha cambiado; vuelve a intentarlo')
      return { ...current, folders: ordered }
    }),
    moveProject: (project, folderId) => update(current => {
      if (typeof project !== 'string' || !current.projects.some(p => key(p.path) === key(project))) throw new Error('El proyecto ya no está en la lista')
      if (folderId !== null && (typeof folderId !== 'string' || !current.folders.some(folder => folder.id === folderId))) throw new Error('La carpeta ya no existe')
      return { ...current, projects: current.projects.map(p => key(p.path) === key(project) ? { ...p, folderId } : p) }
    }),
    setCommand: (project, command) => update(current => {
      if (typeof project !== 'string' || !current.projects.some(p => key(p.path) === key(project))) throw new Error('El proyecto ya no está en la lista')
      if (typeof command !== 'string' || command.length > 4000 || command.includes('\0')) throw new Error('El comando no es válido o supera los 4000 caracteres')
      return { ...current, projects: current.projects.map(p => key(p.path) === key(project) ? { ...p, command: command.trim() ? command : '' } : p) }
    }),
    setAppearance: (project, { name, icon, color, colorTargets }) => update(current => {
      if (colorTargets != null && (typeof colorTargets !== 'object' || ['border', 'text', 'icon'].some(k => typeof colorTargets[k] !== 'boolean'))) throw new Error('Los destinos del color no son válidos')
      if (typeof project !== 'string' || !current.projects.some(p => key(p.path) === key(project))) throw new Error('El proyecto ya no está en la lista')
      if (name != null && (typeof name !== 'string' || name.trim().length > 80)) throw new Error('El nombre debe tener como máximo 80 caracteres')
      if (icon != null && (typeof icon !== 'string' || !/^[a-z0-9-]{1,40}$/.test(icon))) throw new Error('El icono no es válido')
      if (color != null && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) throw new Error('El color no es válido')
      return { ...current, projects: current.projects.map(p => {
        if (key(p.path) !== key(project)) return p
        const { name: _name, icon: _icon, color: _color, colorTargets: _targets, ...others } = p
        const { border, text, icon: tIcon } = colorTargets || {}
        return { ...others, ...(name?.trim() ? { name: name.trim() } : {}), ...(icon ? { icon } : {}), ...(color ? { color } : {}), ...(colorTargets ? { colorTargets: { border, text, icon: tIcon } } : {}) }
      }) }
    }),
    reorder: paths => update(current => {
      if (!Array.isArray(paths) || paths.length !== current.projects.length || paths.some(item => typeof item !== 'string')) throw new Error('El orden de proyectos no es válido')
      const byPath = new Map(current.projects.map(project => [key(project.path), project]))
      const ordered = paths.map(item => byPath.get(key(item)))
      if (byPath.size !== current.projects.length || new Set(paths.map(key)).size !== paths.length || ordered.some(item => !item)) throw new Error('La lista de proyectos ha cambiado; vuelve a intentarlo')
      return { ...current, projects: ordered }
    }),
    remove: project => update(current => ({ ...current, projects: current.projects.filter(p => key(p.path) !== key(project)), activeProject: current.activeProject && key(current.activeProject) === key(project) ? null : current.activeProject, defaultProject: current.defaultProject && key(current.defaultProject) === key(project) ? null : current.defaultProject })),
  }
}
export { createProjectStore }
