import React, { useEffect, useMemo, useState } from 'react'
import { Bot, Code2, ExternalLink, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { FileIcon } from './file-icon.tsx'

const languages: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', rs: 'rust', cs: 'csharp', sh: 'bash', ps1: 'powershell',
  html: 'xml', htm: 'xml', svg: 'xml', md: 'markdown', yml: 'yaml',
  json: 'json', css: 'css', scss: 'scss', xml: 'xml', sql: 'sql',
  go: 'go', java: 'java', rb: 'ruby', php: 'php', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', yaml: 'yaml', toml: 'ini', ini: 'ini',
}
function languageFor(path: string) {
  const name = path.split('/').pop()?.toLowerCase() || ''
  if (name === 'dockerfile') return 'dockerfile'
  return languages[name.split('.').pop() || ''] || ''
}

export function FileViewer({ root, path, onClose, documentation = false, onAsk }: { root: string, path: string, onClose: () => void, documentation?: boolean, onAsk?: () => void }) {
  const [openError, setOpenError] = useState('')
  const [result, setResult] = useState<{ content?: string, error?: string }>({})
  useEffect(() => {
    let cancelled = false
    setResult({})
    window.gitGraph.previewFile(root, path).then(content => { if (!cancelled) setResult({ content }) })
      .catch(error => { if (!cancelled) setResult({ error: error.message || String(error) }) })
    return () => { cancelled = true }
  }, [root, path])
  const language = languageFor(path)
  const highlighted = useMemo(() => {
    if (result.content === undefined || !language || !hljs.getLanguage(language) || result.content.length > 200_000) return null
    return hljs.highlight(result.content, { language, ignoreIllegals: true }).value
  }, [result.content, language])
  const lineNumbers = useMemo(() => {
    if (result.content === undefined) return ''
    const count = result.content.split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1).join('\n')
  }, [result.content])
  const openExternal = (action: string) => {
    setOpenError('')
    window.gitGraph.fileAction(root, path, action).catch(error => setOpenError(error.message || String(error)))
  }
  return <div className="file-viewer">
    <div className="file-viewer-header"><FileIcon path={path}/><strong title={path}>{path}</strong>{documentation && onAsk && <button className="documentation-ask" onClick={onAsk}><Bot size={15}/> Preguntar a la IA</button>}{language && !documentation && <span className="file-viewer-language">{language}</span>}<button className="tool-button" title="Abrir en Visual Studio Code" aria-label="Abrir en Visual Studio Code" onClick={() => openExternal('vscode')}><Code2 size={17}/></button><button className="tool-button" title="Abrir con la aplicación predeterminada" aria-label="Abrir con la aplicación predeterminada" onClick={() => openExternal('open')}><ExternalLink size={16}/></button><button className="tool-button" title="Volver al gráfico" aria-label="Cerrar archivo y volver al gráfico" onClick={onClose}><X size={18}/></button></div>
    {openError && <div className="file-viewer-error" role="alert">{openError}<button className="tool-button" aria-label="Cerrar error" onClick={() => setOpenError('')}><X size={15}/></button></div>}
    {result.error ? <p className="file-preview-message">{result.error}</p> : result.content === undefined ? <p className="file-preview-message">Cargando…</p> : documentation ? <div className="documentation-content" tabIndex={0} aria-label={'Contenido de ' + path}>{/\.mdx?$/i.test(path) ? <div className="forge-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>{result.content}</ReactMarkdown></div> : <pre>{result.content}</pre>}</div> : <div className="code-viewer" tabIndex={0} aria-label={'Contenido de ' + path}>
      <pre className="code-line-numbers" aria-hidden="true">{lineNumbers}</pre>
      <pre className="code-content"><code>{highlighted === null ? result.content : <span dangerouslySetInnerHTML={{ __html: highlighted }}/>}</code></pre>
    </div>}
  </div>
}
