import React from 'react'
import { Atom, Braces, Code, File, FileCog, FileText, Image } from 'lucide-react'

const badge = (label, color) => ({ label, color })
const icon = (Icon, color) => ({ Icon, color })

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
  const kind = BY_EXT[ext]
  const test = /\.(test|spec)\./.test(name)
  if (!kind) return <File size={size} className="file-icon"/>
  const color = test && kind.label ? '#e2574c' : kind.color
  if (kind.label) return <span className="file-icon file-badge" style={{ color, fontSize: Math.round(size * 0.7), width: size, height: size }} aria-hidden="true">{kind.label}</span>
  return <kind.Icon size={size} className="file-icon" style={{ color }} aria-hidden="true"/>
}
