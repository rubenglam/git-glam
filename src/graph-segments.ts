// Render only continuous lanes; joining and newly created lanes are curves.
export function graphSegments(row) {
  const x = lane => 17 + lane * 18
  const curve = (x1, y1, x2, y2) => {
    const middle = (y1 + y2) / 2
    return `M${x1} ${y1} C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`
  }
  const segments: { d: string; lane: number }[] = []
  for (let lane = 0; lane < Math.max(row.before.length, row.after.length); lane++) {
    if (lane === row.col || row.joins.includes(lane)) continue
    if (row.before[lane] && row.before[lane] === row.after[lane]) segments.push({ d: `M${x(lane)} 0 V28`, lane })
  }
  if (row.hasIncoming) segments.push({ d: `M${x(row.col)} 0 V14`, lane: row.col })
  for (const lane of row.joins) segments.push({ d: curve(x(lane), 0, x(row.col), 14), lane })
  if (row.after[row.col]) segments.push({ d: `M${x(row.col)} 14 V28`, lane: row.col })
  for (const lane of row.forks) segments.push({ d: curve(x(row.col), 14, x(lane), 28), lane })
  return segments
}
