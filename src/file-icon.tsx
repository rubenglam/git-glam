import React from 'react'
import { Atom, Braces, Code, File, FileCog, FileText, Image } from 'lucide-react'

const badge = (label, color) => ({ label, color })
const icon = (Icon, color) => ({ Icon, color })

function GitIcon({ size, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path fill="currentColor" d="M21.6 10.7 13.3 2.4a1.8 1.8 0 0 0-2.6 0L9 4.1l2.1 2.1a2.2 2.2 0 0 1 2.7 2.7l2 2a2.2 2.2 0 1 1-1.3 1.2l-1.9-1.9v5a2.2 2.2 0 1 1-1.8 0v-5.1a2.2 2.2 0 0 1-1.2-2.9L7.5 5.5l-5.1 5.2a1.8 1.8 0 0 0 0 2.6l8.3 8.3a1.8 1.8 0 0 0 2.6 0l8.3-8.3a1.8 1.8 0 0 0 0-2.6Z"/>
  </svg>
}

function NodeIcon({ size, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
    <path d="M9.5 8v7.1c0 1.5-.7 2-2 1.3M16.5 9.5c-.5-1.2-3.7-1.4-3.7.4 0 1.7 3.8.8 3.8 2.9 0 1.8-3.1 2.1-4.1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
}

const BY_NAME = {
  '.gitignore': icon(GitIcon, '#f06a6f'),
  'package.json': icon(NodeIcon, '#00d8bf'),
}

// Extension -> look, in the spirit of VS Code's file icons. Test files get a red-orange accent.
const BY_EXT = {
  js: badge('JS', '#e8c547'), cjs: badge('JS', '#e8c547'), mjs: badge('JS', '#e8c547'),
  ts: badge('TS', '#4b9be0'), mts: badge('TS', '#4b9be0'), cts: badge('TS', '#4b9be0'),
  jsx: icon(Atom, '#5fc8e8'), tsx: icon(Atom, '#4b9be0'),
  css: icon(Braces, '#a98be8'), scss: icon(Braces, '#e079b0'), json: icon(Braces, '#e8c547'),
  html: icon(Code, '#e5753a'), md: icon(FileText, '#6aa6d8'), txt: icon(FileText, '#9aa1a8'),
  yaml: icon(FileCog, '#c9807a'), yml: icon(FileCog, '#c9807a'), toml: icon(FileCog, '#c9807a'), lock: icon(FileCog, '#8d959d'),
  png: icon(Image, '#4fb98f'), jpg: icon(Image, '#4fb98f'), jpeg: icon(Image, '#4fb98f'), gif: icon(Image, '#4fb98f'), svg: icon(Image, '#e0a15c'), ico: icon(Image, '#4fb98f'),
  py: badge('PY', '#5b9bd5'), go: badge('GO', '#5fc8e8'), rs: badge('RS', '#d58a5b'), sh: badge('SH', '#8fc27a'), ps1: badge('PS', '#5b9bd5'),
}

export function FileIcon({ path, size = 15 }) {
  const name = path.split('/').pop().toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  const kind = BY_NAME[name] || BY_EXT[ext]
  const test = /\.(test|spec)\./.test(name)
  if (!kind) return <File size={size} className="file-icon"/>
  const color = test && kind.label ? '#e2574c' : kind.color
  if (kind.label) return <span className="file-icon file-badge" style={{ color, fontSize: Math.round(size * 0.7), width: size, height: size }} aria-hidden="true">{kind.label}</span>
  return <kind.Icon size={size} className="file-icon" style={{ color }} aria-hidden="true"/>
}
