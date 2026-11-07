// Small formatting helpers shared by the graph, the commit list and the app shell.

export const GRAPH_PALETTES = {
  classic: ['#009ce9', '#e30094', '#00d625', '#e69a00', '#aa00e8', '#ee4c4c', '#00cabc', '#9be000', '#4f5bff', '#b5651d'],
  ocean: ['#1d6fdc', '#00c2d1', '#7b61ff', '#12a38a', '#ff7f6b', '#f2c14e', '#a3d9ff', '#c04fb5', '#5ee6a8', '#6c7a89'],
  forest: ['#2e9e4f', '#c5d93a', '#8b5a2b', '#e8a317', '#c8432b', '#2aa6a0', '#8e6bbf', '#e68fac', '#9bd0a0', '#d2b48c'],
  sunset: ['#ff4d6d', '#ff8a00', '#ffd23f', '#9b5de5', '#f15bb5', '#00bbf9', '#2ec4b6', '#c1121f', '#7c83fd', '#ffa69e'],
  pastel: ['#7aa2f7', '#f7768e', '#9ece6a', '#e0af68', '#bb9af7', '#73daca', '#ff9e64', '#7dcfff', '#f4b8e4', '#d4a373'],
}
export const color = (i, colors = GRAPH_PALETTES.classic) => colors[i % colors.length]
export const date = value => value ? new Date(value).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : ''
export const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
