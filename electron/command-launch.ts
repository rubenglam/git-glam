import { spawn } from 'node:child_process'
import path from 'node:path'

// The command is user-authored PowerShell; paths are passed only through cwd and environment.
function launchProjectCommand({ command, project, worktree }: { command: string; project: string; worktree: string }, spawnProcess: (...args: any[]) => any = spawn) {
  if (process.platform !== 'win32') return Promise.reject(new Error('La ejecución de comandos requiere Windows'))
  if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0')) return Promise.reject(new Error('Configura un comando válido para este proyecto'))
  if (typeof project !== 'string' || typeof worktree !== 'string' || !project || !worktree) return Promise.reject(new Error('Proyecto o worktree no válido'))
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const encoded = Buffer.from(command, 'utf16le').toString('base64')
  return new Promise<void>((resolve, reject) => {
    let child
    try {
      child = spawnProcess(shell, ['-NoLogo', '-NoExit', '-EncodedCommand', encoded], {
        cwd: worktree, detached: true, stdio: 'ignore', windowsHide: false,
        env: { ...process.env, GITGRAPH_PROJECT: project, GITGRAPH_WORKTREE: worktree },
      })
    } catch (error) { reject(new Error(`No se pudo abrir PowerShell: ${error.message}`)); return }
    child.once('error', error => reject(new Error(`No se pudo abrir PowerShell: ${error.message}`)))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
export { launchProjectCommand }
