// Parses the patch part of `git show --patch` into files with numbered lines. Text before the first
// "diff --git" (the --stat summary) is dropped because the file tree already shows it.
import type { ParsedDiffFile } from '../types.ts'

export function parseDiff(text: string): ParsedDiffFile[] {
  return text.split(/^(?=diff --git )/m).filter(section => section.startsWith('diff --git ')).map(section => {
    const lines = section.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0])
    const file: ParsedDiffFile = { path: header ? header[2] : lines[0], notes: [], lines: [], hunks: 0, added: 0, deleted: 0 }
    let inHunk = false, oldNo = 0, newNo = 0
    for (const line of lines.slice(1)) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
      if (hunk) { inHunk = true; oldNo = Number(hunk[1]); newNo = Number(hunk[2]); file.lines.push({ type: 'hunk', text: hunk[3].trim() || line, header: line, index: file.hunks++ }); continue }
      if (!inHunk) {
        if (line.startsWith('+++ b/')) file.path = line.slice(6).replace(/\t$/, '')
        else if (line.startsWith('--- a/') && !file.notes.includes('Archivo eliminado')) file.pathFallback = line.slice(6).replace(/\t$/, '')
        else if (line.startsWith('new file mode')) file.notes.push('Archivo nuevo')
        else if (line.startsWith('deleted file mode')) file.notes.push('Archivo eliminado')
        else if (line.startsWith('Binary files')) file.notes.push('Archivo binario')
        else if (line.startsWith('old mode') || line.startsWith('rename ')) file.notes.push(line)
        continue
      }
      if (line.startsWith('+')) { file.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ }); file.added++ }
      else if (line.startsWith('-')) { file.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ }); file.deleted++ }
      else if (line.startsWith('\\')) file.lines.push({ type: 'note', text: line.slice(2) })
      else file.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
    if (file.notes.includes('Archivo eliminado') && file.pathFallback) file.path = file.pathFallback
    delete file.pathFallback
    return file
  })
}
