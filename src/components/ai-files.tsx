import React, { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ClipboardList, Copy, ExternalLink, FileSearch, FileText, Network, Plug, Search, Settings, ShoppingBag, Sparkles, Wrench } from 'lucide-react'

type FileEntry = { path: string }
type Skill = { name: string, path: string, entry?: string }

function provider(path: string): string {
  const parts = path.toLowerCase().split('/')
  const name = parts.at(-1) || ''
  if (parts.includes('.claude') || name === 'claude.md') return 'Claude'
  if (parts.includes('.codex')) return 'Codex'
  if (parts.includes('.gemini') || name === 'gemini.md') return 'Gemini'
  if (parts.includes('.cursor') || name === '.cursorrules') return 'Cursor'
  if (parts.includes('.windsurf') || name === '.windsurfrules') return 'Windsurf'
  if (parts.includes('.opencode')) return 'OpenCode'
  if (parts.includes('.github') || name === 'copilot-instructions.md') return 'GitHub Copilot'
  if (name.startsWith('.aider.')) return 'Aider'
  return 'Proyecto'
}

function agentName(path: string): string {
  return (path.split('/').pop() || path).replace(/\.agent\.md$|\.(md|toml|yaml|yml|json)$/i, '')
}

function agentIcon(path: string) {
  switch (agentName(path).toLowerCase()) {
    case 'orchestrator': return Network
    case 'planner': return ClipboardList
    case 'reviewer': return FileSearch
    case 'scout': return Search
    case 'worker': return Wrench
    default: return Bot
  }
}

export function AiFiles({ root, selectedPath, onSelect }: { root: string, selectedPath?: string, onSelect: (path: string) => void }) {
  const [result, setResult] = useState<{ files: FileEntry[], truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [linkError, setLinkError] = useState('')
  const [agentProvider, setAgentProvider] = useState('')
  const [showAgentConfig, setShowAgentConfig] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [copied, setCopied] = useState(false)
  const [prompt, setPrompt] = useState('Analiza este repositorio y crea un archivo AGENTS.md en la raíz con instrucciones útiles para los agentes: estructura del proyecto, comandos de desarrollo y pruebas, y convenciones importantes. Basa las instrucciones en los archivos existentes y evita inventar información.')
  useEffect(() => {
    let live = true
    setResult(null); setError('')
    window.gitGraph.aiFiles(root).then(value => { if (live) setResult(value) }).catch(e => { if (live) setError(e.message || String(e)) })
    return () => { live = false }
  }, [root])
  const data = useMemo(() => {
    const instructions: FileEntry[] = [], agents: FileEntry[] = [], locks: FileEntry[] = [], integrations: FileEntry[] = [], files: FileEntry[] = []
    const skills = new Map<string, Skill>()
    for (const file of result?.files || []) {
      const parts = file.path.split('/'), lower = parts.map(part => part.toLowerCase()), name = lower.at(-1) || ''
      const index = lower.findIndex(part => part === 'skills' || part === '.skills')
      if (index >= 0 && parts.length > index + 2) {
        const path = parts.slice(0, index + 2).join('/')
        const skill = skills.get(path) || { name: parts[index + 1], path }
        if (name === 'skill.md' && parts.length === index + 3) skill.entry = file.path
        skills.set(path, skill)
      } else if (name === 'agents.md' || name === 'agents.override.md') instructions.push(file)
      else if (name === 'skills-lock.json') locks.push(file)
      else if (lower.includes('agents') || name.endsWith('.agent.md')) agents.push(file)
      else if (name.includes('marketplace') || name === '.mcp.json' || name === 'mcp.json' || lower.includes('.mcp') || lower.includes('mcp') || lower.includes('.claude-plugin')) integrations.push(file)
      else files.push(file)
    }
    const needle = query.trim().toLowerCase()
    const match = (path: string, extra = '') => !needle || `${path} ${provider(path)} ${extra}`.toLowerCase().includes(needle)
    return { instructions: instructions.filter(f => match(f.path, 'instrucciones agentes')), agents: agents.filter(f => match(f.path, 'agente')), skills: [...skills.values()].filter(s => match(s.path, 'skills')).sort((a, b) => a.name.localeCompare(b.name)), locks: locks.filter(f => match(f.path, 'skills')), integrations: integrations.filter(f => match(f.path, 'mcp marketplace')), files: files.filter(f => match(f.path)) }
  }, [result, query])
  const fileButton = (file: FileEntry) => <button key={file.path} className={'ai-file' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelect(file.path)}><FileText size={15}/><span className="ai-file-text"><strong>{file.path.split('/').pop()}</strong><small>{file.path}</small></span><span className="ai-file-kind">{provider(file.path)}</span></button>
  const agentProviders = [...new Set([...data.agents, ...data.files].map(file => provider(file.path)))].sort((a, b) => a.localeCompare(b))
  const selectedProvider = agentProviders.includes(agentProvider) ? agentProvider : agentProviders[0]
  const visibleAgents = data.agents.filter(file => provider(file.path) === selectedProvider)
  const orchestrator = visibleAgents.find(file => agentName(file.path).toLowerCase() === 'orchestrator')
  const agentCard = (file: FileEntry) => { const Icon = agentIcon(file.path); return <button key={file.path} className={'ai-agent' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelect(file.path)}><Icon size={15}/><span className="ai-file-text"><strong>{agentName(file.path)}</strong></span></button> }
  const hasRootInstructions = result?.files.some(file => file.path.toLowerCase() === 'agents.md')
  const hasResults = data.instructions.length + data.agents.length + data.skills.length + data.locks.length + data.integrations.length + data.files.length > 0
  return <>
    <div className="explorer-search repository-search"><Search size={13}/><input value={query} placeholder="Buscar IA o agentes…" aria-label="Buscar archivos de IA y agentes" onChange={event => setQuery(event.target.value)}/></div>
    {error ? <p className="panel-empty" role="alert">{error}</p> : !result ? <p className="panel-empty">Buscando archivos de IA…</p> : <div className="ai-groups">
      {(data.instructions.length > 0 || (!query && !hasRootInstructions && !result.truncated)) && <section className="ai-instructions" aria-label="Instrucciones para agentes">
        <div className="ai-instructions-cards">{data.instructions.map(file => <button key={file.path} className={'ai-instruction-card' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelect(file.path)}><FileText size={15}/><span className="ai-file-text"><strong>{file.path.split('/').pop()}</strong>{file.path.includes('/') && <small>{file.path.slice(0, file.path.lastIndexOf('/'))}</small>}</span></button>)}</div>
        {!query && !hasRootInstructions && !result.truncated && <div className="ai-generate">
          <div className="ai-generate-intro">
            <span className="ai-generate-icon"><FileText size={18}/></span>
            <div><strong>AGENTS.md</strong><p>Aún no hay instrucciones para agentes en la raíz del repositorio.</p></div>
          </div>
          <button className="ai-generate-toggle" onClick={() => setShowPrompt(value => !value)} aria-expanded={showPrompt} aria-controls="agents-prompt-panel"><Sparkles size={14}/>{showPrompt ? 'Ocultar prompt' : 'Preparar prompt'}</button>
          {showPrompt && <div className="ai-prompt-panel" id="agents-prompt-panel"><label htmlFor="agents-generation-prompt">Prompt para tu agente</label><p>Edita y copia este texto para pedirle a tu agente que cree el archivo.</p><textarea id="agents-generation-prompt" value={prompt} onChange={event => { setPrompt(event.target.value); setCopied(false) }}/><button className="ai-copy-prompt" onClick={() => { navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setLinkError('') }).catch(e => setLinkError(e.message || String(e))) }}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copiado' : 'Copiar prompt'}</button>{linkError && <p className="ai-link-error" role="alert">{linkError}</p>}</div>}
        </div>}
      </section>}
      {(data.agents.length > 0 || data.files.length > 0) && <section className="ai-group" aria-label="Agentes"><div className="ai-group-heading"><Bot size={16}/><strong>Agentes</strong><span className="ai-group-count">{data.agents.length}</span>{data.files.length > 0 && <button type="button" className="ai-config-toggle" title="Configuración de agentes" aria-label="Configuración de agentes" aria-expanded={showAgentConfig} onClick={() => setShowAgentConfig(value => !value)}><Settings size={15}/></button>}</div><div className="ai-category"><div className="ai-provider-tabs" role="tablist" aria-label="Asistente de los agentes">{agentProviders.map(name => <button key={name} role="tab" aria-selected={selectedProvider === name} className={selectedProvider === name ? 'active' : ''} onClick={() => setAgentProvider(name)}>{name} <span>{data.agents.filter(file => provider(file.path) === name).length}</span></button>)}</div><div role="tabpanel" aria-label={selectedProvider}>{showAgentConfig && <div className="ai-agent-config">{data.files.filter(file => provider(file.path) === selectedProvider).length ? data.files.filter(file => provider(file.path) === selectedProvider).map(fileButton) : <p className="ai-section-hint">Sin archivos de configuración para {selectedProvider}.</p>}</div>}{orchestrator && visibleAgents.length > 1 ? <div className="ai-agent-tree" title="Organización visual basada en los nombres de los agentes"><div className="ai-agent-root">{agentCard(orchestrator)}</div><div className="ai-agent-children">{visibleAgents.filter(file => file !== orchestrator).map(file => <div className="ai-agent-child" key={file.path}>{agentCard(file)}</div>)}</div></div> : <div className="ai-agent-grid">{visibleAgents.map(agentCard)}</div>}</div></div></section>}
      <section className="ai-group" aria-label="Skills"><div className="ai-group-heading"><Sparkles size={16}/><strong>Skills</strong><span className="ai-group-count">{data.skills.length}</span><button className="ai-skills-link" title="Explorar skills.sh" aria-label="Explorar skills.sh" onClick={() => window.gitGraph.openIssue('https://skills.sh/').then(() => setLinkError('')).catch(e => setLinkError(e.message || String(e)))}><ExternalLink size={15}/></button></div><div className="ai-category">{linkError && <p className="ai-link-error" role="alert">{linkError}</p>}{data.skills.length > 0 && <p className="ai-section-hint">Skills disponibles</p>}{data.skills.length > 0 && <div className="ai-skills">{data.skills.map(skill => skill.entry ? <button key={skill.path} className={'ai-skill' + (selectedPath === skill.entry ? ' active' : '')} title={`${skill.path} — abrir SKILL.md`} onClick={() => onSelect(skill.entry!)}><Sparkles size={14}/><span className="ai-skill-content"><strong>{skill.name}</strong></span></button> : <span key={skill.path} className="ai-skill" title={`${skill.path} — sin SKILL.md`}><Sparkles size={14}/><span className="ai-skill-content"><strong>{skill.name}</strong><small>Sin SKILL.md</small></span></span>)}</div>}{data.locks.length > 0 && <><div className="ai-lock-files">{data.locks.map(file => <button key={file.path} className={'ai-lock-file' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelect(file.path)}><FileText size={14}/><span>{file.path.split('/').pop()}</span></button>)}</div></>}</div></section>
      {data.integrations.length > 0 && <section className="ai-group" aria-label="MCP y marketplaces"><div className="ai-group-heading"><Plug size={16}/><strong>MCP y marketplaces</strong><span className="ai-group-count">{data.integrations.length}</span></div><div className="ai-category ai-integrations">{([ ['MCP', data.integrations.filter(file => !file.path.toLowerCase().includes('marketplace'))], ['Marketplaces', data.integrations.filter(file => file.path.toLowerCase().includes('marketplace'))] ] as [string, FileEntry[]][]).map(([label, entries]) => entries.length > 0 && <div className="ai-integration-group" key={label}><div className="ai-integration-heading">{label === 'MCP' ? <Plug size={13}/> : <ShoppingBag size={13}/>}<strong>{label}</strong><span>{entries.length}</span></div><div className="ai-integration-grid">{entries.map(file => <button key={file.path} className={'ai-integration-card' + (selectedPath === file.path ? ' active' : '')} title={file.path} onClick={() => onSelect(file.path)}><FileText size={15}/><span className="ai-file-text"><strong>{file.path.split('/').pop()}</strong><small>{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : 'Raíz del repositorio'}</small></span></button>)}</div></div>)}</div></section>}
      {!hasResults && <p className="panel-empty">{query ? 'No se encontraron archivos para esta búsqueda.' : 'No se encontraron archivos de IA o agentes en este repositorio.'}</p>}
      {result.truncated && <p className="panel-empty">Se alcanzó el límite de archivos examinados o resultados.</p>}
    </div>}
  </>
}
