import React, { useEffect, useState } from 'react'

// Saves (or removes) the access token used to read the issues of one repository. The saved value is never sent back to the UI.
export function IssueTokenForm({ root, onChanged }: { root: string; onChanged?: () => void }) {
  const [configured, setConfigured] = useState<any>(null), [value, setValue] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => { let active = true; setConfigured(null); window.gitGraph.hasIssueToken(root).then(has => { if (active) setConfigured(has) }, () => { if (active) setConfigured(false) }); return () => { active = false } }, [root])
  async function save(token) {
    setSaving(true); setError('')
    try { await window.gitGraph.setIssueToken(root, token); setValue(''); setConfigured(Boolean(token.trim())); onChanged?.() } catch (failure) { setError(failure.message || String(failure)) } finally { setSaving(false) }
  }
  return <form className="issue-token" onSubmit={event => { event.preventDefault(); if (value.trim()) save(value) }}>
    <label htmlFor="issue-token-input">Token de acceso de este repositorio {configured && <em className="token-ok">configurado</em>}</label>
    <p>GitHub: token con acceso de lectura a los issues. GitLab: token con permiso <code>read_api</code>. Se guarda cifrado en este equipo y no se vuelve a mostrar.</p>
    <div className="issue-token-controls">
      <input id="issue-token-input" type="password" autoComplete="off" spellCheck="false" value={value} disabled={saving || configured === null} placeholder={configured ? '••••••••••••  (escribe para reemplazarlo)' : 'Pega aquí el token'} onChange={event => { setValue(event.target.value); setError('') }}/>
      <button className="settings-save" type="submit" disabled={saving || !value.trim()}>Guardar</button>
      {configured && <button type="button" className="settings-remove" disabled={saving} onClick={() => save('')}>Quitar</button>}
    </div>
    {error && <div className="action-error" role="alert">{error}</div>}
  </form>
}
