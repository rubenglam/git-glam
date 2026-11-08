import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Rocket, TriangleAlert } from 'lucide-react'
import type { ReleaseInfo } from '../types.ts'
import { compareVersions, isVersion, versionOptions } from '../lib/release-flow.ts'

type Step = 'loading' | 'choose' | 'running' | 'done'

/** Dev-only dialog: pick the next version (recommended one preselected) and run `pnpm release --publish`. */
export function ReleaseDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('loading')
  const [info, setInfo] = useState<ReleaseInfo | null>(null)
  const [choice, setChoice] = useState('')
  const [custom, setCustom] = useState('')
  const [skipBump, setSkipBump] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    window.gitGraph.releaseInfo()
      .then(next => { setInfo(next); setChoice(versionOptions(next.version, next.commits).find(o => o.recommended)!.version); setStep(next.running ? 'running' : 'choose') })
      .catch(e => { setError(e.message || String(e)); setStep('choose') })
  }, [])

  useEffect(() => {
    const stopLog = window.gitGraph.onReleaseLog(line => setLog(lines => [...lines.slice(-400), line]))
    const stopDone = window.gitGraph.onReleaseDone(result => { setStep('done'); setError(result.ok ? '' : result.error || 'La publicación ha fallado') })
    return () => { stopLog(); stopDone() }
  }, [])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [log])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && step !== 'running') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  }, [step, onClose])

  const options = useMemo(() => info ? versionOptions(info.version, info.commits) : [], [info])
  const version = skipBump && info ? info.version : choice === 'custom' ? custom.trim() : choice
  const customProblem = skipBump || choice !== 'custom' || !info ? '' : !isVersion(version) ? 'Usa el formato x.y.z' : compareVersions(version, info.version) <= 0 ? `Debe ser mayor que ${info.version}` : ''
  const canStart = step === 'choose' && !!info && !!version && !customProblem

  async function start() {
    if (!canStart) return
    setError(''); setLog([]); setStep('running')
    try { await window.gitGraph.releaseRun(version, skipBump) } catch (e) { setError(e.message || String(e)); setStep('choose') }
  }

  const running = step === 'running'
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !running) onClose() }}>
    <div className="action-dialog release-dialog" role="dialog" aria-modal="true" aria-label="Publicar nueva versión">
      <h2><Rocket size={17} aria-hidden="true"/> Publicar nueva versión</h2>
      {step === 'loading' && <p>Analizando cambios…</p>}
      {info && step !== 'loading' && <>
        <p>Versión actual <strong>{info.version}</strong>{info.lastTag ? <> · {info.commits.length} commit{info.commits.length === 1 ? '' : 's'} desde <code>{info.lastTag}</code></> : ''} · rama <code>{info.branch}</code></p>
        {info.dirty && step === 'choose' && <div className="release-warning" role="alert"><TriangleAlert size={14} aria-hidden="true"/> Hay cambios sin confirmar. El instalador se construirá con ellos.</div>}
        {step === 'choose' && <label className="release-skip"><input type="checkbox" checked={skipBump} onChange={event => setSkipBump(event.target.checked)}/><span><strong>Mantener la versión actual ({info.version})</strong><small>No modifica package.json, Cargo.toml ni tauri.conf.json: compila y publica directamente.</small></span></label>}
        {step === 'choose' && !skipBump && <div className="release-options" role="radiogroup" aria-label="Número de versión">
          {options.map(option => <label key={option.bump} className={'release-option' + (choice === option.version ? ' selected' : '')}>
            <input type="radio" name="release-version" checked={choice === option.version} onChange={() => setChoice(option.version)}/>
            <span className="release-option-version">{option.version}</span>
            <span className="release-option-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
            {option.recommended && <span className="release-recommended">Recomendada</span>}
          </label>)}
          <label className={'release-option' + (choice === 'custom' ? ' selected' : '')}>
            <input type="radio" name="release-version" checked={choice === 'custom'} onChange={() => setChoice('custom')}/>
            <span className="release-option-version">Otra</span>
            <input className="release-custom" type="text" inputMode="numeric" placeholder="x.y.z" aria-label="Versión personalizada" value={custom} onFocus={() => setChoice('custom')} onChange={event => { setCustom(event.target.value); setChoice('custom') }}/>
          </label>
          {customProblem && custom && <small className="release-problem">{customProblem}</small>}
        </div>}
        {step === 'choose' && !skipBump && info.commits.length > 0 && <details className="release-commits"><summary>Cambios incluidos</summary><ul>{info.commits.slice(0, 40).map((commit, i) => <li key={i}>{commit}</li>)}</ul></details>}
        {(running || step === 'done') && <>
          <p aria-live="polite">{running ? <>Publicando <strong>v{version || info.version}</strong>… no cierres la app.</> : error ? 'La publicación ha fallado.' : <>Versión publicada correctamente.</>}</p>
          <pre className="release-log" ref={logRef} aria-label="Salida del proceso">{log.join('\n') || 'Esperando salida…'}</pre>
        </>}
      </>}
      {error && <div className="action-error" role="alert">{error}</div>}
      <div className="action-buttons">
        <button type="button" disabled={running} onClick={onClose}>{step === 'done' ? 'Cerrar' : 'Cancelar'}</button>
        {step !== 'done' && <button className="confirm" type="button" disabled={!canStart} onClick={() => void start()}>{running ? 'Publicando…' : version ? `Publicar ${version}` : 'Publicar'}</button>}
      </div>
    </div>
  </div>
}

/** Settings → About row, rendered only in local development builds. */
export function ReleaseRow() {
  const [open, setOpen] = useState(false)
  return <div className="settings-row settings-release-dev" role="group" aria-label="Publicar versión">
    <div className="settings-row-copy"><label>Publicar nueva versión</label><p>Solo en desarrollo: compila el instalador firmado y crea la release en GitHub.</p></div>
    <button className="settings-save" type="button" onClick={() => setOpen(true)}><Rocket size={13} aria-hidden="true"/>Publicar versión…</button>
    {open && <ReleaseDialog onClose={() => setOpen(false)}/>}
  </div>
}
