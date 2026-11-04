import React from 'react'
import { FolderGit2, Folder, Rocket, Globe, Server, Database, Smartphone, Code, Terminal, Package, Box, Cloud, Cpu, Bug, Wrench, Zap, Star, Heart, Gamepad2, Palette, ShoppingCart, BookOpen } from 'lucide-react'

export const PROJECT_ICONS = { 'folder-git': FolderGit2, folder: Folder, rocket: Rocket, globe: Globe, server: Server, database: Database, smartphone: Smartphone, code: Code, terminal: Terminal, package: Package, box: Box, cloud: Cloud, cpu: Cpu, bug: Bug, wrench: Wrench, zap: Zap, star: Star, heart: Heart, gamepad: Gamepad2, palette: Palette, cart: ShoppingCart, book: BookOpen }
export const PROJECT_COLORS = ['#e5737a', '#e0a15c', '#d9b85b', '#7fc08a', '#5fb8b0', '#80bce5', '#9a8be0', '#d287c4']

export const DEFAULT_COLOR_TARGETS = { border: false, text: false, icon: true }
export const colorClasses = project => { const t = project.colorTargets || DEFAULT_COLOR_TARGETS; return (t.border ? 'colored ' : '') + (t.text ? 'color-text ' : '') + (t.icon ? 'color-icon ' : '') }
export const folderName = path => path.split(/[\\/]/).filter(Boolean).pop() || path
export const projectName = project => project.name || folderName(project.path)
export function ProjectIcon({ project, size = 15 }) {
  const Icon = PROJECT_ICONS[project.icon] || FolderGit2
  return <Icon size={size}/>
}
