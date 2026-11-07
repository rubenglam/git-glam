import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, GitBranch, CloudDownload, Ellipsis, LoaderCircle } from 'lucide-react'

export function SyncBar({ repo, busy, syncing, onSync, onPickBranch }) {
  const info = repo.sync?.[repo.branch], detached = repo.branch === 'HEAD separado'
  const [menu, setMenu] = useState(false), box = useRef<any>(null)
  useEffect(() => {
    if (!menu) return
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !box.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [menu])
  const icon = (kind, Icon) => syncing === kind ? <LoaderCircle className="spin" size={15}/> : <Icon size={15}/>
  const run = kind => { setMenu(false); onSync(kind) }
  const pullTitle = info ? `Pull desde ${info.upstream}` + (info.behind ? ` (${info.behind} por recibir)` : '') : 'Pull'
  const pushTitle = info && !info.gone ? `${info.ahead} commits por enviar · ${info.behind} por recibir\nComparado con ${info.upstream}; datos del último fetch.` : 'Push (publicará la rama)'
  return <><div className="scm-row">
    <button className="branch-button" title="Cambiar de rama" aria-label={'Rama actual: ' + repo.branch + '. Cambiar de rama'} disabled={busy} onClick={onPickBranch}><GitBranch size={15}/><strong>{repo.branch}</strong><ChevronDown size={14}/></button>
    <button className="sync-icon" title={pullTitle} aria-label={pullTitle} disabled={busy || detached} onClick={() => onSync('pull')}>{icon('pull', ArrowDown)}{info?.behind > 0 && <b aria-hidden="true">{info.behind > 99 ? '99+' : info.behind}</b>}</button>
    <button className="sync-icon" title={pushTitle} aria-label={pushTitle} disabled={busy || detached} onClick={() => onSync('push')}>{icon('push', ArrowUp)}{info?.ahead > 0 && <b aria-hidden="true">{info.ahead > 99 ? '99+' : info.ahead}</b>}</button>
    <div className="sync-menu-wrap" ref={box}>
      <button className="sync-icon" title="Más acciones" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}>{syncing === 'fetch' ? <LoaderCircle className="spin" size={15}/> : <Ellipsis size={16}/>}</button>
      {menu && <div className="sync-menu" role="menu">
        <button role="menuitem" onClick={() => run('fetch')}><CloudDownload size={14}/>Fetch<small>Actualiza todos los remotos y etiquetas; elimina referencias remotas obsoletas</small></button>
        <button role="menuitem" disabled={detached} onClick={() => run('pull')}><ArrowDown size={14}/>Pull<small>{info ? 'Desde ' + info.upstream + ' · solo avance rápido' : 'Recibir cambios · solo avance rápido'}</small></button>
        <button role="menuitem" disabled={detached} onClick={() => run('push')}><ArrowUp size={14}/>Push<small>{info ? 'Envía commits a ' + info.upstream : 'Publica la rama y configura su seguimiento'}</small></button>
      </div>}
    </div>
  </div>
  {(detached || !info || info.gone) && <div className="git-status" role="status">
    {detached ? 'HEAD separado: no hay una rama activa para sincronizar.' : !info ? 'Esta rama no tiene una rama de seguimiento configurada.' : `La rama de seguimiento ${info.upstream} ya no existe.`}
  </div>}</>
}
