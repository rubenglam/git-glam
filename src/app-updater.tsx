import React, { useState, useSyncExternalStore } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

type Phase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
interface State { phase: Phase; update: Update | null; progress: number | null; error: string }

const FIRST_CHECK_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Shared store so the background check, the app bar notice and Settings → About agree.
let state: State = { phase: 'idle', update: null, progress: null, error: '' }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const useUpdater = () => useSyncExternalStore(subscribe, () => state)

/** `silent` checks (background) never surface errors or replace a found update. */
export async function checkForUpdate(silent = false) {
  if (!isTauri() || state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready') return
  if (silent && state.phase === 'available') return
  set({ phase: 'checking', error: '' })
  try {
    const found = await check()
    set({ update: found, phase: found ? 'available' : 'none' })
  } catch (e) {
    if (silent) set({ phase: state.update ? 'available' : 'idle' })
    else set({ error: String(e), phase: 'error' })
  }
}

export async function installUpdate() {
  const update = state.update
  if (!update || state.phase === 'downloading') return
  set({ phase: 'downloading', progress: 0, error: '' })
  let total = 0, received = 0
  try {
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0
      else if (event.event === 'Progress') { received += event.data.chunkLength; set({ progress: total ? Math.min(100, Math.round(received / total * 100)) : null }) }
    })
    set({ phase: 'ready' })
    await relaunch()
  } catch (e) { set({ error: String(e), phase: 'error' }) }
}

/** Periodically looks for a new version; only runs in the installed app. Returns a cleanup. */
export function startUpdateChecks() {
  if (!isTauri()) return () => {}
  let first: ReturnType<typeof setTimeout> | undefined, every: ReturnType<typeof setInterval> | undefined, stopped = false
  window.gitGraph.isPackaged().then(packaged => {
    if (!packaged || stopped) return
    first = setTimeout(() => void checkForUpdate(true), FIRST_CHECK_MS)
    every = setInterval(() => void checkForUpdate(true), CHECK_INTERVAL_MS)
  }).catch(() => {})
  return () => { stopped = true; clearTimeout(first); clearInterval(every) }
}

/** App bar button shown only when a new version is available. */
export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  const { phase, update } = useUpdater()
  if (phase !== 'available' || !update) return null
  return <button className="update-badge" type="button" title="Hay una nueva versión. Abrir Acerca de para actualizar." onClick={onOpen}>Actualización {update.version}</button>
}

/** Bottom-right alert shown once per version when an update is found. */
export function UpdateToast() {
  const { phase, update, progress, error } = useUpdater()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const visible = update && dismissed !== update.version && (phase === 'available' || phase === 'downloading' || phase === 'ready' || (phase === 'error' && !!error))
  if (!visible) return null
  return <div className="update-toast" role="status" aria-live="polite">
    <strong>Nueva versión {update.version}</strong>
    <p>{phase === 'downloading' ? `Descargando e instalando…${progress !== null ? ` ${progress}%` : ''}` : phase === 'ready' ? 'Reiniciando…' : phase === 'error' ? `No se pudo actualizar: ${error}` : 'Hay una actualización disponible de Git Glam.'}</p>
    {(phase === 'available' || phase === 'error') && <div className="update-toast-actions">
      <button className="settings-save" type="button" onClick={() => void installUpdate()}>{phase === 'error' ? 'Reintentar' : 'Actualizar ahora'}</button>
      <button type="button" onClick={() => setDismissed(update.version)}>Más tarde</button>
    </div>}
  </div>
}

/** Settings → About: manual check and install. */
export function AppUpdater({ enabled }: { enabled: boolean }) {
  const { phase, update, progress, error } = useUpdater()
  if (!isTauri()) return null
  const busy = phase === 'checking' || phase === 'downloading'
  return <div className="settings-row" role="group" aria-label="Actualizaciones">
    <div className="settings-row-copy">
      <label>Actualizaciones</label>
      <p aria-live="polite">
        {phase === 'idle' && (enabled ? 'Se busca una versión nueva automáticamente cada pocas horas.' : 'Las actualizaciones solo funcionan en la versión instalada.')}
        {phase === 'checking' && 'Buscando actualizaciones…'}
        {phase === 'none' && 'Tienes la última versión.'}
        {phase === 'available' && update && `Nueva versión ${update.version} disponible.`}
        {phase === 'downloading' && `Descargando e instalando…${progress !== null ? ` ${progress}%` : ''}`}
        {phase === 'ready' && 'Actualización instalada. Reiniciando…'}
        {phase === 'error' && `No se pudo actualizar: ${error}`}
      </p>
    </div>
    {phase === 'available'
      ? <button className="settings-save" type="button" onClick={() => void installUpdate()}>Actualizar y reiniciar</button>
      : <button className="settings-save" type="button" disabled={busy || phase === 'ready' || !enabled} onClick={() => void checkForUpdate()}>Buscar actualizaciones</button>}
  </div>
}
