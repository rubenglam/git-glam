import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createGitGraphBridge } from './git-graph-bridge.ts'

// Maps the renderer-facing API to Tauri commands and events.
const routes: Record<string, (args: any[]) => [string, Record<string, unknown>]> = {
  'app:is-packaged': () => ['is_packaged', {}],
  'projects:status': ([paths]) => ['project_status', { paths }],
  'projects:add': () => ['project_add', {}],
  'projects:open': ([project, showRemote]) => ['project_open', { project, showRemote }],
  'projects:worktree': ([project, dir, showRemote]) => ['project_worktree', { project, dir, showRemote }],
  'projects:list': () => ['projects_list', {}],
  'projects:select': ([project]) => ['projects_update', { action: 'select', project }],
  'projects:default': ([project]) => ['projects_update', { action: 'default', project }],
  'projects:remove': ([project]) => ['projects_update', { action: 'remove', project }],
  'projects:appearance:set': ([project, value]) => ['projects_update', { action: 'appearance', project, value }],
  'projects:command:run': ([project, worktree]) => ['run_project_command', { project, worktree }],
  'projects:command:set': ([project, value]) => ['projects_update', { action: 'command', project, value }],
  'projects:move': ([project, value]) => ['projects_update', { action: 'move', project, value }],
  'projects:reorder': ([value]) => ['projects_update', { action: 'reorder', value }],
  'folders:create': ([value]) => ['projects_update', { action: 'folder_create', value }],
  'folders:rename': ([project, value]) => ['projects_update', { action: 'folder_rename', project, value }],
  'folders:delete': ([project]) => ['projects_update', { action: 'folder_delete', project }],
  'folders:reorder': ([value]) => ['projects_update', { action: 'folder_reorder', value }],
  'agent:send': ([dir, request]) => ['agent_send', { dir, request }],
  'agent:cancel': ([id]) => ['agent_cancel', { id }],
  'agent:load': ([root]) => ['data_load', { kind: 'agent', root }],
  'agent:save': ([root, data]) => ['data_save', { kind: 'agent', root, data }],
  'improvements:load': ([root]) => ['data_load', { kind: 'improvements', root }],
  'improvements:save': ([root, data]) => ['data_save', { kind: 'improvements', root, data }],
  'tokens:has': ([dir]) => ['token_has', { dir }],
  'tokens:set': ([dir, value]) => ['token_set', { dir, value }],
  'settings:read': () => ['read_settings', {}],
  'settings:set': ([key, value]) => ['set_setting', { key, value }],
  'repo:file-history': ([dir, file, rev]) => ['file_history', { dir, file, rev }],
  'repo:file-blame': ([dir, file, rev]) => ['file_blame', { dir, file, rev }],
  'repo:forge-detail': ([dir, kind, id]) => ['forge_detail', { dir, kind, id }],
  'repo:forge-comment': ([dir, kind, id, body]) => ['forge_comment', { dir, kind, id, body }],
  'repo:forge-facets': ([dir, kind]) => ['forge_facets', { dir, kind }],
  'repo:forge-list': ([dir, kind, options]) => ['forge_list', { dir, kind, options }],
  'repo:forge-info': ([dir]) => ['forge_info', { dir }],
  'repo:diff': ([dir, hash]) => ['commit_diff', { dir, hash }],
  'repo:commit-files': ([dir, hash]) => ['commit_files', { dir, hash }],
  'repo:file-action': ([dir, file, action]) => ['file_action', { dir, file, action }],
  'repo:open': () => ['open_repo', {}],
  'repo:open-folder': ([dir]) => ['open_folder', { dir }],
  'app:open-issue': ([url]) => ['open_issue', { url }],
  'repo:load': ([dir, showRemote, limit]) => ['load_repo', { dir, showRemote, limit }],
  'repo:history': ([dir, showRemote, limit]) => ['history', { dir, showRemote, limit }],
  'repo:commit-action': ([dir, request]) => ['commit_action', { dir, request }],
  'repo:branches': ([dir]) => ['list_branches', { dir }],
  'repo:switch-branch': ([dir, reference]) => ['switch_branch', { dir, reference }],
  'repo:create-branch': ([dir, name]) => ['create_branch', { dir, name }],
  'repo:delete-remote-branch': ([dir, reference]) => ['delete_remote_branch', { dir, reference }],
  'repo:set-upstream': ([dir, name, reference]) => ['set_upstream', { dir, name, reference }],
  'repo:checkout-remote': ([dir, reference, name]) => ['checkout_remote', { dir, reference, name }],
  'repo:branch-op': ([dir, action, reference]) => ['branch_operation', { dir, action, reference }],
  'repo:rename-branch': ([dir, name, newName]) => ['rename_branch', { dir, name, newName }],
  'repo:delete-branch': ([dir, name, force]) => ['delete_branch', { dir, name, force }],
  'repo:fetch': ([dir]) => ['sync_repo', { dir, action: 'fetch' }],
  'repo:pull': ([dir]) => ['sync_repo', { dir, action: 'pull' }],
  'repo:push': ([dir]) => ['sync_repo', { dir, action: 'push' }],
  'repo:stage': ([dir, paths]) => ['stage_paths', { dir, paths }],
  'repo:unstage': ([dir, paths]) => ['unstage_paths', { dir, paths }],
  'repo:apply-hunk': ([dir, request]) => ['apply_hunk', { dir, request }],
  'repo:discard-hunk': ([dir, request]) => ['discard_hunk', { dir, request }],
  'repo:working-diff': ([dir, request]) => ['working_diff', { dir, request }],
  'repo:discard': ([dir, paths]) => ['discard_paths', { dir, paths }],
  'repo:staged-diff': ([dir]) => ['staged_diff', { dir }],
  'repo:last-message': ([dir]) => ['last_message', { dir }],
  'repo:generate-message': ([dir, id]) => ['generate_message', { dir, id }],
  'repo:cancel-message': ([id]) => ['cancel_message', { id }],
  'repo:commit-push': ([dir, message, options]) => ['commit_push', { dir, message, options }],
  'repo:commit': ([dir, message, options]) => ['commit', { dir, message, options }],
  'repo:stash-push': ([dir, options]) => ['stash_push', { dir, options }],
  'repo:stash-apply': ([dir, hash]) => ['stash_action', { dir, hash, action: 'apply' }],
  'repo:stash-pop': ([dir, hash]) => ['stash_action', { dir, hash, action: 'pop' }],
  'repo:stash-drop': ([dir, hash]) => ['stash_action', { dir, hash, action: 'drop' }],
  'repo:tags': ([dir]) => ['list_tags', { dir }],
  'repo:create-tag': ([dir, request]) => ['create_tag', { dir, request }],
  'repo:delete-tag': ([dir, name, options]) => ['delete_tag', { dir, name, remote: options?.remote, remoteName: options?.remoteName }],
  'repo:push-tag': ([dir, name, remoteName]) => ['push_tag', { dir, name, remoteName }],
}

if (isTauri()) {
  const subscriptions = new Map<(...args: any[]) => void, { cancelled: boolean; stop?: UnlistenFn }>()
  window.gitGraph = createGitGraphBridge({
    async invoke(channel, ...args) {
      const route = routes[channel]
      if (!route) throw new Error(`Comando de Tauri desconocido: ${channel}`)
      const [command, params] = route(args)
      try { return await invoke(command, params) } catch (error) { throw new Error(String(error)) }
    },
    on(channel, callback) {
      const subscription: { cancelled: boolean; stop?: UnlistenFn } = { cancelled: false }
      subscriptions.set(callback, subscription)
      void listen(channel, event => callback(undefined, ...(Array.isArray(event.payload) ? event.payload : [event.payload])))
        .then(stop => { if (subscription.cancelled) stop(); else subscription.stop = stop })
        .catch(error => console.error('No se pudo escuchar el evento de Tauri', error))
    },
    removeListener(_channel, callback) {
      const subscription = subscriptions.get(callback)
      if (subscription) { subscription.cancelled = true; subscription.stop?.(); subscriptions.delete(callback) }
    },
  })
}

// Apply the previous layout only where the current value is absent or still the default.
export function applyElectronUi(saved: Record<string, string>, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const defaults: Record<string, string> = { 'gitgraph.hiddenTabs': '[]', 'gitgraph.hiddenFolders': '[]', 'gitgraph.collapsedGroups': '[]', 'gitgraph.tabColors': '{}', 'gitgraph.leftWidth': '235', 'gitgraph.rightWidth': '260', 'gitgraph.panelOrder': '["branches","graph","changes"]' }
  for (const [key, value] of Object.entries(saved)) {
    const current = storage.getItem(key)
    if (current === null || (Object.hasOwn(defaults, key) && current === defaults[key])) storage.setItem(key, value)
  }
}

export async function migrateElectronUi() {
  if (!isTauri() || localStorage.getItem('gitgraph.electronUiImported')) return
  try {
    const saved = await invoke<Record<string, string>>('electron_ui_settings')
    applyElectronUi(saved, localStorage)
    localStorage.setItem('gitgraph.electronUiImported', '1')
  } catch (error) { console.warn('No se pudo importar la disposición de Electron', error) }
}
