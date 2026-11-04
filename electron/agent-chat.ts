import { spawn } from 'node:child_process'

const MAX_PROMPT = 20000
const MODES = { read: ['--permission-mode', 'default', '--allowed-tools', 'Read', 'Grep', 'Glob'], edit: ['--permission-mode', 'acceptEdits'] }

// Tokens occupying the context after a response: everything sent plus what was generated.
const contextTokens = usage => usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0) : 0

// Turns one stream-json line from `claude -p` into a UI event, or null when it carries nothing to show.
function parseAgentLine(line) {
  let data
  try { data = JSON.parse(line) } catch { return null }
  if (data.type === 'system' && data.subtype === 'init' && data.session_id) return { type: 'session', sessionId: data.session_id }
  if (data.type === 'stream_event' && data.event?.type === 'content_block_delta' && data.event.delta?.type === 'text_delta') return { type: 'delta', text: data.event.delta.text }
  if (data.type === 'assistant') {
    const tools = (data.message?.content || []).filter(part => part.type === 'tool_use').map(part => ({ name: part.name, detail: part.input?.file_path || part.input?.pattern || part.input?.command || part.input?.path || '' }))
    const usage = contextTokens(data.message?.usage)
    return tools.length || usage ? { type: 'tools', tools, ...(usage ? { tokens: usage } : {}) } : null
  }
  if (data.type === 'result') return { type: 'done', text: typeof data.result === 'string' ? data.result : '', error: data.is_error === true, sessionId: data.session_id, contextWindow: (Object.values(data.modelUsage || {})[0] as { contextWindow?: number } | undefined)?.contextWindow }
  return null
}

const MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export interface AgentRequest { prompt?: string; sessionId?: string; mode?: string; model?: string; effort?: string }

function agentArgs({ sessionId, mode, model, effort }: AgentRequest) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...(MODES[mode as string] || MODES.read)]
  if (MODELS.includes(model as string)) args.push('--model', model as string)
  if (EFFORTS.includes(effort as string)) args.push('--effort', effort as string)
  if (sessionId) args.push('--resume', sessionId)
  return args
}

// Runs a prompt through the claude CLI inside the repository; `emit` receives parsed events. Returns { cancel }.
function runAgent(dir, { prompt, sessionId, mode, model, effort }: AgentRequest, emit: (event: any) => void, spawnProcess: (...args: any[]) => any = spawn) {
  if (typeof dir !== 'string' || !dir) throw new Error('Repositorio no válido')
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) throw new Error('Escribe un prompt válido')
  if (sessionId !== undefined && sessionId !== null && !/^[\w-]{8,64}$/.test(sessionId)) throw new Error('Sesión no válida')
  const child = spawnProcess('claude', agentArgs({ sessionId: sessionId || undefined, mode, model, effort }), { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = '', err = '', finished = false, cancelled = false
  const finish = event => { if (!finished) { finished = true; emit(event) } }
  const handle = line => { const event = line.trim() && parseAgentLine(line); if (event) { if (event.type === 'done') finished = true; emit(event) } }
  child.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(handle) })
  child.stderr.on('data', chunk => { err += chunk })
  child.on('error', (error: NodeJS.ErrnoException) => finish({ type: 'done', error: true, text: error.code === 'ENOENT' ? 'No se encontró la CLI «claude». Instálala e inicia sesión para usar el chat.' : error.message }))
  child.on('close', code => {
    handle(buffer)
    if (cancelled) finish({ type: 'done', cancelled: true, text: '' })
    else finish(code === 0 ? { type: 'done', text: '' } : { type: 'done', error: true, text: err.trim() || `claude terminó con código ${code}` })
  })
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
  return { cancel: () => { cancelled = true; child.kill() } }
}

export { parseAgentLine, agentArgs, runAgent, MODELS, EFFORTS }
