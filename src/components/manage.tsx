import React, { useEffect, useState } from 'react'
import { ConfirmDialog, FormDialog } from './dialogs.tsx'

const api = () => window.gitGraph
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

// --- context-menu item builders (pure: each item's `run` just asks the App to open a dialog) ---

export const branchItems = (branch, { current, tracking }, open) => branch.remote ? [
  { label: 'Checkout como rama local…', run: () => open({ kind: 'checkout-remote', branch }) },
  null,
  { label: 'Borrar rama remota…', danger: true, run: () => open({ kind: 'delete-remote', branch }) },
] : [
  { label: 'Renombrar…', run: () => open({ kind: 'rename-branch', branch }) },
  { label: 'Establecer upstream…', run: () => open({ kind: 'set-upstream', branch }) },
  { label: 'Dejar de seguir el upstream', disabled: !tracking, run: () => open({ kind: 'unset-upstream', branch }) },
  null,
  { label: 'Borrar rama…', danger: true, disabled: branch.name === current, run: () => open({ kind: 'delete-branch', branch }) },
]

// Menu for a branch badge in the graph. `direct(type, branch)` runs actions that need no dialog; the rest open one.
export const graphBranchItems = (branch, { current, tracking }, open, direct) => {
  const isCurrent = !branch.remote && branch.name === current
  return [
    { label: 'Checkout de la rama…', disabled: isCurrent, run: () => branch.remote ? open({ kind: 'checkout-remote', branch }) : direct('checkout', branch) },
    branch.remote ? { label: 'Borrar rama remota…', danger: true, run: () => open({ kind: 'delete-remote', branch }) } : { label: 'Borrar rama…', danger: true, disabled: isCurrent, run: () => open({ kind: 'delete-branch', branch }) },
    ...(branch.remote ? [{ label: 'Fetch en la rama local…', run: () => open({ kind: 'branch-fetch', branch }) }] : []),
    { label: 'Merge en la rama actual…', disabled: isCurrent, run: () => open({ kind: 'branch-merge', branch }) },
    { label: 'Pull en la rama actual…', disabled: !branch.remote && !tracking, run: () => open({ kind: 'branch-pull', branch }) },
    null,
    { label: 'Crear archivo ZIP', run: () => direct('archive', branch) },
    null,
    { label: 'Copiar nombre de la rama', run: () => direct('copy', branch) },
  ]
}

export const stashItems = (stash, open) => [
  { label: 'Aplicar (conservar el stash)', run: () => open({ kind: 'stash-apply', stash }) },
  { label: 'Pop (aplicar y eliminar)', run: () => open({ kind: 'stash-pop', stash }) },
  null,
  { label: 'Eliminar stash…', danger: true, run: () => open({ kind: 'stash-drop', stash }) },
]

export const tagItems = (tag, open, copy) => [
  { label: 'Copiar nombre de la etiqueta', run: () => copy(tag.name) },
  null,
  { label: 'Subir al remoto', run: () => open({ kind: 'tag-push', tag }) },
  null,
  { label: 'Borrar etiqueta…', danger: true, run: () => open({ kind: 'tag-delete', tag }) },
]

function UpstreamDialog({ root, branch, onClose, onDone }) {
  const [remotes, setRemotes] = useState<any>(null)
  useEffect(() => { let active = true; api().branches(root).then(data => { if (active) setRemotes(data.branches.filter(item => item.remote)) }).catch(() => { if (active) setRemotes([]) }); return () => { active = false } }, [root])
  if (!remotes) return null
  if (!remotes.length) return <ConfirmDialog title="Establecer upstream" description="No hay ramas remotas. Haz un fetch primero." confirmLabel="Cerrar" danger={false} onConfirm={async () => {}} onCancel={onClose} onDone={onClose}/>
  const guess = remotes.find(item => item.name.slice(item.name.indexOf('/') + 1) === branch.name) || remotes[0]
  return <FormDialog title={`Upstream de «${branch.name}»`} description="La rama local seguirá a la rama remota elegida (pull y push usarán esa referencia)." choices={[{ key: 'ref', label: 'Rama remota', initial: guess.ref, options: remotes.map(item => [item.ref, item.name]) }]} confirmLabel="Establecer" onSubmit={values => api().setUpstream(root, branch.name, values.ref)} onCancel={onClose} onDone={() => onDone('Upstream establecido')}/>
}

// Renders the dialog for whatever the App asked to manage; `onDone(notice)` closes it and refreshes the repository.
export function ManageDialog({ request, root, onClose, onDone }) {
  const done = notice => () => onDone(notice)
  const { kind } = request
  if (kind === 'discard') {
    const { paths } = request
    return <ConfirmDialog title="Descartar cambios" description="Los cambios sin preparar se perderán de forma permanente; los archivos nuevos sin seguimiento se eliminarán. Los cambios ya preparados se conservan." confirmLabel="Descartar" details={<>{paths.slice(0, 8).map(path => <code key={path}>{path}</code>)}{paths.length > 8 && <span>…y {paths.length - 8} más</span>}</>} onConfirm={() => api().discard(root, paths)} onCancel={onClose} onDone={done('Cambios descartados (' + count(paths.length, 'archivo', 'archivos') + ')')}/>
  }
  if (kind === 'discard-hunk') return <ConfirmDialog title="Descartar bloque" description="Este bloque se eliminará del directorio de trabajo de forma permanente." confirmLabel="Descartar" details={<><code>{request.hunk.path}</code><span>{request.hunk.header}</span></>} onConfirm={() => api().discardHunk(root, request.hunk)} onCancel={onClose} onDone={done('Bloque descartado')}/>
  if (kind === 'rename-branch') return <FormDialog title="Renombrar rama" description={`Rama actual: ${request.branch.name}`} fields={[{ key: 'name', label: 'Nuevo nombre', initial: request.branch.name }]} required={['name']} confirmLabel="Renombrar" onSubmit={values => api().renameBranch(root, request.branch.name, values.name.trim())} onCancel={onClose} onDone={done('Rama renombrada')}/>
  if (kind === 'delete-branch') return <FormDialog title={`Borrar la rama «${request.branch.name}»`} description="Se borra solo la rama local; sus commits permanecen mientras otra referencia los alcance." checks={[{ key: 'force', label: 'Forzar aunque tenga commits sin fusionar' }]} confirmLabel="Borrar" onSubmit={values => api().deleteBranch(root, request.branch.name, values.force)} onCancel={onClose} onDone={done('Rama borrada')}/>
  if (kind === 'set-upstream') return <UpstreamDialog root={root} branch={request.branch} onClose={onClose} onDone={onDone}/>
  if (kind === 'unset-upstream') return <ConfirmDialog title="Dejar de seguir el upstream" description={`«${request.branch.name}» dejará de seguir a su rama remota. La rama remota no se modifica.`} confirmLabel="Quitar" danger={false} onConfirm={() => api().setUpstream(root, request.branch.name, null)} onCancel={onClose} onDone={done('Upstream eliminado')}/>
  if (kind === 'checkout-remote') {
    const { branch } = request
    return <FormDialog title="Checkout de rama remota" description={`Se creará una rama local que sigue a ${branch.name} y se cambiará a ella.`} fields={[{ key: 'name', label: 'Nombre de la rama local', initial: branch.name.slice(branch.name.indexOf('/') + 1) }]} required={['name']} confirmLabel="Crear y cambiar" onSubmit={values => api().checkoutRemote(root, branch.ref, values.name.trim())} onCancel={onClose} onDone={done('Rama local creada')}/>
  }
  if (kind === 'delete-remote') return <ConfirmDialog title="Borrar rama remota" description={`Se ejecutará «git push --delete» y la rama ${request.branch.name} desaparecerá del servidor para todo el equipo.`} confirmLabel="Borrar del remoto" onConfirm={() => api().deleteRemoteBranch(root, request.branch.ref)} onCancel={onClose} onDone={done('Rama remota borrada')}/>
  if (kind === 'branch-merge') {
    const { branch } = request
    return <FormDialog title="Merge" description={`Se fusionará «${branch.name}» en la rama actual.`} checks={[{ key: 'ffOnly', label: 'Solo avance rápido (--ff-only): falla si no puede avanzar sin crear un commit de merge' }]} confirmLabel="Merge" onSubmit={values => api().branchOp(root, values.ffOnly ? 'merge-ff-only' : 'merge', branch.ref)} onCancel={onClose} onDone={done('Merge completado')}/>
  }
  if (kind === 'branch-pull' || kind === 'branch-fetch') {
    const { branch } = request, op = kind.slice(7), label = { pull: 'Pull', fetch: 'Fetch' }[op]
    const description = { pull: `Se traerán e integrarán en la rama actual los cambios de «${branch.name}».`, fetch: `Se actualizará la rama local «${branch.name.slice(branch.name.indexOf('/') + 1)}» desde ${branch.name} (solo avance rápido).` }[op]
    return <ConfirmDialog title={label} description={description} confirmLabel={label} danger={false} onConfirm={() => api().branchOp(root, op, branch.ref)} onCancel={onClose} onDone={done(label + ' completado')}/>
  }
  if (kind === 'stash-create') return <FormDialog title="Guardar cambios en un stash" description="Guarda los cambios locales y deja el directorio de trabajo limpio." fields={[{ key: 'message', label: 'Mensaje (opcional)', placeholder: 'WIP: …' }]} checks={[{ key: 'includeUntracked', label: 'Incluir archivos sin seguimiento', initial: true }, { key: 'keepIndex', label: 'Conservar los cambios ya preparados en el área de preparación', initial: false }]} confirmLabel="Guardar stash" onSubmit={values => api().stashPush(root, values)} onCancel={onClose} onDone={done('Stash creado')}/>
  if (kind === 'stash-apply' || kind === 'stash-pop') {
    const pop = kind === 'stash-pop'
    return <ConfirmDialog title={pop ? 'Pop del stash' : 'Aplicar stash'} description={pop ? 'Se aplicarán los cambios y, si no hay conflictos, el stash se eliminará.' : 'Se aplicarán los cambios; el stash se conserva.'} details={<><strong>{request.stash.stash}</strong><span>{request.stash.subject}</span></>} confirmLabel={pop ? 'Pop' : 'Aplicar'} danger={false} onConfirm={() => pop ? api().stashPop(root, request.stash.hash) : api().stashApply(root, request.stash.hash)} onCancel={onClose} onDone={done(pop ? 'Pop completado' : 'Stash aplicado')}/>
  }
  if (kind === 'stash-drop') return <ConfirmDialog title="Eliminar stash" description="El stash se eliminará de forma permanente." details={<><strong>{request.stash.stash}</strong><span>{request.stash.subject}</span></>} confirmLabel="Eliminar" onConfirm={() => api().stashDrop(root, request.stash.hash)} onCancel={onClose} onDone={done('Stash eliminado')}/>
  if (kind === 'tag-create') return <FormDialog title="Nueva etiqueta" description="Se crea en el commit actual (HEAD). Con mensaje será anotada; sin mensaje, ligera." fields={[{ key: 'name', label: 'Nombre', placeholder: 'v1.0.0' }, { key: 'message', label: 'Mensaje (opcional, crea una etiqueta anotada)', multiline: true }]} required={['name']} confirmLabel="Crear" onSubmit={values => api().createTag(root, { name: values.name.trim(), message: values.message })} onCancel={onClose} onDone={done('Etiqueta creada')}/>
  if (kind === 'tag-delete') return <FormDialog title={`Borrar la etiqueta «${request.tag.name}»`} description="Se borra la etiqueta local." checks={[{ key: 'remote', label: 'Borrarla también del remoto' }]} confirmLabel="Borrar" onSubmit={async values => { if (values.remote) await api().deleteTag(root, request.tag.name, { remote: true }); await api().deleteTag(root, request.tag.name).catch(error => { if (!values.remote) throw error }) }} onCancel={onClose} onDone={done('Etiqueta borrada')}/>
  if (kind === 'tag-push') return <ConfirmDialog title="Subir etiqueta" description={`Se enviará «${request.tag.name}» al remoto.`} confirmLabel="Subir" danger={false} onConfirm={() => api().pushTag(root, request.tag.name)} onCancel={onClose} onDone={done('Etiqueta subida')}/>
  return null
}
