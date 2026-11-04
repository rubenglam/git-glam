// Parses `git show --numstat -z --no-renames` output: "added\tdeleted\tpath\0" per file; binary files report "-".
function parseNumstat(output) {
  return output.split('\0').map(entry => entry.replace(/^\n/, '')).filter(Boolean).map(entry => {
    const first = entry.indexOf('\t'), second = entry.indexOf('\t', first + 1)
    if (first < 0 || second < 0) return null
    const added = entry.slice(0, first), deleted = entry.slice(first + 1, second)
    const binary = added === '-' || deleted === '-'
    return { path: entry.slice(second + 1), added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted), binary }
  }).filter(Boolean)
}

export { parseNumstat }
