import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, LoaderCircle, Plus, Search, Star, X } from 'lucide-react'
import { moveProjectTab } from './project-order.ts'
import { ProjectIcon, PROJECT_COLORS, projectName, colorClasses } from './project-icons.tsx'
import { useStoredState } from './use-stored-state.ts'

const TAB_COLORS = PROJECT_COLORS

export function statusText(status) {
  const parts: string[] = []
  if (status.dirty) parts.push(status.dirty + ' cambios sin confirmar')
  if (status.ahead) parts.push(status.ahead + ' commits por enviar')
  if (status.behind) parts.push(status.behind + ' commits por recibir')
  return parts.length ? '\n' + parts.join(' · ') : ''
}


export function ProjectTabs({ onSaveAppearance, onHideFolder, onMoveTab, groupTabs, showUngroupedLabel, tabLabelWidth, folders, statuses, projects: allProjects, savedProjects, activeProject, defaultProject, showProjects, loadingProject, refreshingProject, busy, onProjects, onOpen, onAdd, onReorder, onReorderFolders, onClose }) {
  const dragging = useRef<any>(null)
  const addMenuRef = useRef<any>(null), [addMenuOpen, setAddMenuOpen] = useState(false), [addMenuAlign, setAddMenuAlign] = useState('left'), [addMenuQuery, setAddMenuQuery] = useState(''), [addMenuSearchOpen, setAddMenuSearchOpen] = useState(false)
  useEffect(() => {
    if (!addMenuOpen) return
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !addMenuRef.current?.contains(event.target)) setAddMenuOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [addMenuOpen])
  const [collapsed, setCollapsed] = useStoredState('gitgraph.collapsedGroups', []), [colors, setColors] = useStoredState('gitgraph.tabColors', {}), [colorMenu, setColorMenu] = useState<any>(null)
  const grouped = groupTabs && folders.length > 0
  const tabGroups = useMemo(() => {
    if (!grouped) return [{ key: 'all', label: null, items: allProjects.map((project, index) => ({ project, index })) }]
    const defs = [...folders.map(folder => ({ key: 'f:' + folder.id, label: folder.name, projects: allProjects.filter(project => project.folderId === folder.id) })), { key: 'f:none', label: showUngroupedLabel ? 'Sin carpeta' : null, projects: allProjects.filter(project => !project.folderId || !folders.some(folder => folder.id === project.folderId)) }]
    let index = 0
    return defs.filter(def => def.projects.length).map(def => ({ key: def.key, label: def.label, items: def.projects.map(project => ({ project, index: index++ })) }))
  }, [allProjects, folders, grouped, showUngroupedLabel])
  const projects = useMemo(() => tabGroups.flatMap(group => group.items.map(item => item.project)), [tabGroups])
  const availableProjects = savedProjects.filter(project => !allProjects.some(open => open.path === project.path))
  const toggleGroup = id => setCollapsed(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id])
  const setColor = (key, color) => {
    if (!key.startsWith('f:')) { setColorMenu(null); setColors(old => { if (!(key in old)) return old; const next = { ...old }; delete next[key]; return next }); onSaveAppearance(key, { color: color || null }).catch(() => {}); return }
    setColors(old => { const next = { ...old }; if (color) next[key] = color; else delete next[key]; return next }); setColorMenu(null) }
  useEffect(() => {
    const onKey = event => {
      if (busy || !event.ctrlKey || event.altKey || event.metaKey || !projects.length) return
      let target: { path: string } | null | undefined = null
      if (/^[1-9]$/.test(event.key)) target = event.key === '9' ? projects[projects.length - 1] : projects[Number(event.key) - 1]
      else if (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp') {
        const backwards = event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey), current = showProjects ? -1 : projects.findIndex(project => project.path === activeProject)
        target = projects[current < 0 ? (backwards ? projects.length - 1 : 0) : (current + (backwards ? -1 : 1) + projects.length) % projects.length]
      }
      if (!target) return
      event.preventDefault(); onOpen(target.path)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [projects, activeProject, showProjects, busy, onOpen])
  useEffect(() => {
    if (!colorMenu) return
    const close = event => { if (event.type === 'keydown' && event.key !== 'Escape') return; setColorMenu(null) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close) }
  }, [colorMenu])
  const listRef = useRef<any>(null), [overflow, setOverflow] = useState({ left: false, right: false, any: false })
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onWheel = event => { if (list.scrollWidth > list.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); list.scrollLeft += event.deltaY } }
    const update = () => setOverflow({ left: list.scrollLeft > 1, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1, any: list.scrollWidth > list.clientWidth + 1 })
    update(); list.addEventListener('wheel', onWheel, { passive: false }); list.addEventListener('scroll', update)
    const observer = new ResizeObserver(update); observer.observe(list); if (list.firstElementChild) [...list.children].forEach(child => observer.observe(child))
    return () => { list.removeEventListener('wheel', onWheel); list.removeEventListener('scroll', update); observer.disconnect() }
  }, [projects.length, collapsed, grouped])
  const scrollTabs = direction => listRef.current?.scrollBy({ left: direction * Math.max(160, listRef.current.clientWidth * .6), behavior: 'smooth' })
  useEffect(() => { if (!showProjects) [...(listRef.current?.querySelectorAll('.projects-tab') ?? [])].find(tab => tab.dataset.projectPath === activeProject)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [activeProject, showProjects, projects.length, collapsed])
  const openColorMenu = (event, key) => { event.preventDefault(); setColorMenu({ key, x: Math.min(event.clientX, window.innerWidth - 190), y: event.clientY }) }
  const [dragPath, setDragPath] = useState<any>(null), [target, setTarget] = useState<any>(null), [tabGroupTarget, setTabGroupTarget] = useState<any>(null)
  const folderOf = key => key === 'f:none' ? null : key.slice(2)
  const folderDragRef = useRef<any>(null), [folderDrag, setFolderDrag] = useState<any>(null), [folderTarget, setFolderTarget] = useState<any>(null)
  function clearFolderDrag() { folderDragRef.current = null; setFolderDrag(null); setFolderTarget(null) }
  function clearDrag() { dragging.current = null; setDragPath(null); setTarget(null); setTabGroupTarget(null) }
  return <nav className="project-tabs" aria-label="Proyectos" style={{ '--tab-label-width': tabLabelWidth + 'px' } as React.CSSProperties}>
    <button className={'projects-tab '+(showProjects ? 'active' : '')} aria-current={showProjects ? 'page' : undefined} onClick={onProjects}><FolderOpen size={15}/> Proyectos</button>
    <span id="project-tabs-help" className="visually-hidden">Arrastra las pestañas para cambiar su orden o usa Alt y las flechas izquierda y derecha.</span>
    {overflow.any && <button className="tabs-scroll" aria-label="Desplazar pestañas a la izquierda" disabled={!overflow.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={14}/></button>}<div className="project-tabs-list" ref={listRef}>{tabGroups.map(group => { const isCollapsed = group.label !== null && collapsed.includes(group.key), groupColor = colors[group.key]; return <div key={group.key} className={'tab-group'+(group.label === null ? ' plain' : '')+(folderTarget?.key === group.key ? ' drop-' + folderTarget.side : '')+(isCollapsed ? ' collapsed' : '')+(tabGroupTarget === group.key ? ' drop-tab' : '')} style={groupColor ? { '--group-color': groupColor } as React.CSSProperties : undefined} role="group" aria-label={group.label === null ? undefined : 'Carpeta ' + group.label} onDragOver={event => {
      if (dragging.current && grouped) { const source = projects.find(item => item.path === dragging.current), sameGroup = source && group.items.some(item => item.project.path === source.path); if (!sameGroup) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTabGroupTarget(group.key) } return }
      if (!folderDragRef.current || folderDragRef.current === group.key) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect(), side = group.key === 'f:none' || event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before'
      setFolderTarget(previous => previous?.key === group.key && previous.side === side ? previous : { key: group.key, side })
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTabGroupTarget(previous => previous === group.key ? null : previous); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderTarget(previous => previous?.key === group.key ? null : previous) }} onDrop={event => {
      if (dragging.current && grouped) { event.preventDefault(); const path = dragging.current; clearDrag(); if (!group.items.some(item => item.project.path === path)) onMoveTab(path, folderOf(group.key), null); return }
      if (!folderDragRef.current || folderDragRef.current === group.key) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect(), none = group.key === 'f:none'
      const side = none || event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before', targetKey = none ? 'f:' + folders[folders.length - 1]?.id : group.key
      const next = moveProjectTab(folders.map(folder => ({ path: 'f:' + folder.id, folder })), folderDragRef.current, targetKey, side).map(item => item.folder)
      onReorderFolders(next); clearFolderDrag()
    }}>{group.label !== null && <button className={'tab-group-label'+(group.key !== 'f:none' && folderDrag === group.key ? ' dragging' : '')} aria-expanded={!isCollapsed} title={(isCollapsed ? 'Expandir' : 'Contraer') + ' «' + group.label + '»\nClic derecho para elegir un color' + (group.key !== 'f:none' ? '\nArrastra para reordenar' : '')} onClick={() => toggleGroup(group.key)} onContextMenu={event => openColorMenu(event, group.key)} draggable={!busy && group.key !== 'f:none'} onDragStart={event => {
      folderDragRef.current = group.key; setFolderDrag(group.key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.key)
    }} onDragEnd={clearFolderDrag}>{isCollapsed ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}<Folder size={12}/><span>{group.label}</span>{isCollapsed && <em>{group.items.length}</em>}</button>}{group.label !== null && group.key !== 'f:none' && <button className="tab-group-hide" title="Ocultar carpeta (los proyectos siguen en Proyectos)" aria-label={'Ocultar carpeta ' + group.label} disabled={busy} onClick={() => onHideFolder(folderOf(group.key))}><X size={11}/></button>}{group.label !== null && !isCollapsed && <span className="tab-group-sep" aria-hidden="true"/>}{group.items.filter(({ project }) => !isCollapsed || (!showProjects && project.path === activeProject)).map(({ project, index }) => { const color = project.color || colors[project.path] || colors[group.key], status = statuses[project.path]; return <button key={project.path} style={color ? { '--tab-color': color } as React.CSSProperties : undefined} onContextMenu={event => openColorMenu(event, project.path)} data-project-path={project.path} className={'projects-tab '+(color ? (project.color ? colorClasses(project) : 'colored ') : '')+(status?.dirty > 0 ? 'has-dirty ' : '')+(status?.ahead > 0 ? 'has-ahead ' : '')+(status?.behind > 0 ? 'has-behind ' : '')+(!showProjects && activeProject === project.path ? 'active ' : '')+(dragPath === project.path ? 'dragging ' : '')+(target?.path === project.path ? `drop-${target.side}` : '')} aria-current={!showProjects && activeProject === project.path ? 'page' : undefined} aria-describedby="project-tabs-help" title={project.path + '\nArrastra para reordenar' + (status ? statusText(status) : '')} disabled={busy} draggable={!busy} onClick={() => onOpen(project.path)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(project.path) } }} onDragStart={event => {
      dragging.current = project.path; setDragPath(project.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.path)
    }} onDragOver={event => {
      if (!dragging.current || dragging.current === project.path) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      setTarget(previous => previous?.path === project.path && previous.side === side ? previous : { path: project.path, side })
    }} onDragLeave={() => {
      setTarget(previous => previous?.path === project.path ? null : previous)
    }} onDrop={event => {
      if (!dragging.current || dragging.current === project.path) return
      event.preventDefault(); event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after', path = dragging.current
      const crossFolder = grouped && !group.items.some(item => item.project.path === path)
      clearDrag()
      if (crossFolder) onMoveTab(path, folderOf(group.key), project.path, side)
      else onReorder(moveProjectTab(projects, path, project.path, side))
    }} onDragEnd={clearDrag} onKeyDown={event => {
      if (event.key === 'Delete' && !busy) { event.preventDefault(); onClose(project.path); return }
      if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const offset = event.key === 'ArrowLeft' ? -1 : 1
      const other = projects[index + offset]
      if (!other) return
      event.preventDefault(); onReorder(moveProjectTab(projects, project.path, other.path, offset < 0 ? 'before' : 'after'), project.path)
    }}>{loadingProject === project.path || refreshingProject === project.path ? <LoaderCircle className="spin" size={15} role="img" aria-label={loadingProject === project.path ? 'Cargando proyecto' : 'Actualizando proyecto'}/> : <ProjectIcon project={project}/>}<span>{projectName(project)}</span>{defaultProject === project.path && <Star className="default-star" size={12} fill="currentColor"/>}{status?.dirty > 0 && <i className="tab-dirty" role="img" aria-label={status.dirty + ' cambios sin confirmar'}/>}{status?.ahead > 0 && <b className="tab-sync" aria-label={status.ahead + ' commits por enviar'}>↑{status.ahead}</b>}{status?.behind > 0 && <b className="tab-sync" aria-label={status.behind + ' commits por recibir'}>↓{status.behind}</b>}<span className="tab-close" aria-hidden="true" title="Ocultar pestaña (Supr)" onClick={event => { event.stopPropagation(); if (!busy) onClose(project.path) }}><X size={12}/></span></button> })}</div> })}</div>
    {colorMenu && <div className="tab-color-menu" role="menu" aria-label="Color" style={{ left: colorMenu.x, top: colorMenu.y }} onPointerDown={event => event.stopPropagation()}>{TAB_COLORS.map(color => <button key={color} role="menuitem" aria-label={'Color ' + color} className={(allProjects.find(project => project.path === colorMenu.key)?.color || colors[colorMenu.key]) === color ? 'selected' : ''} style={{ background: color }} onClick={() => setColor(colorMenu.key, color)}/>)}<button role="menuitem" className="tab-color-clear" onClick={() => setColor(colorMenu.key, null)}>Sin color</button></div>}
    {overflow.any && <button className="tabs-scroll" aria-label="Desplazar pestañas a la derecha" disabled={!overflow.right} onClick={() => scrollTabs(1)}><ChevronRight size={14}/></button>}
    <div className="add-project-wrap" ref={addMenuRef}>
      <button className="tool-button add-project-tab" title="Añadir proyecto" aria-label="Añadir proyecto" aria-haspopup="menu" aria-expanded={addMenuOpen} disabled={busy} onClick={() => { if (!addMenuOpen && addMenuRef.current) { const rect = addMenuRef.current.getBoundingClientRect(); setAddMenuAlign(window.innerWidth - rect.left >= 230 ? 'left' : 'right') } setAddMenuQuery(''); setAddMenuSearchOpen(false); setAddMenuOpen(open => !open) }}><Plus size={16}/></button>
      {addMenuOpen && <div className={"add-project-menu align-" + addMenuAlign} role="menu" aria-label="Añadir proyecto">
        {availableProjects.length > 0 && <><div className="add-project-heading"><span>Proyectos guardados</span><button className="add-project-search-toggle" type="button" aria-label={addMenuSearchOpen ? "Cerrar búsqueda" : "Buscar proyecto"} aria-expanded={addMenuSearchOpen} onClick={() => { setAddMenuSearchOpen(open => !open); setAddMenuQuery('') }}><Search size={14}/></button></div>{addMenuSearchOpen && <input className="add-project-search" type="search" placeholder="Buscar proyecto…" aria-label="Buscar proyecto" value={addMenuQuery} onChange={event => setAddMenuQuery(event.target.value)} autoFocus/>}<div className="add-project-list">{availableProjects.filter(project => projectName(project).toLocaleLowerCase().includes(addMenuQuery.trim().toLocaleLowerCase())).map(project => { const groupKey = grouped ? (folders.some(folder => folder.id === project.folderId) ? 'f:' + project.folderId : 'f:none') : 'all', color = project.color || colors[project.path] || colors[groupKey]; return <button key={project.path} role="menuitem" className={'add-project-item ' + (color ? (project.color ? colorClasses(project) : 'colored ') : '')} style={color ? { '--tab-color': color } as React.CSSProperties : undefined} onClick={() => { setAddMenuOpen(false); onOpen(project.path) }}><ProjectIcon project={project}/><span>{projectName(project)}</span></button> })}{!availableProjects.some(project => projectName(project).toLocaleLowerCase().includes(addMenuQuery.trim().toLocaleLowerCase())) && <div className="add-project-empty">No hay coincidencias</div>}</div></>}
        <button className="add-project-new" role="menuitem" onClick={() => { setAddMenuOpen(false); onAdd() }}><FolderOpen size={15}/><span>Abrir un proyecto nuevo</span></button>
      </div>}
    </div>
  </nav>
}
