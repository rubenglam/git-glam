const download = '/download'
const repository = 'https://github.com/rubenglam/project-git-branch'

function ProductPreview() {
  const commits = [
    ['Polish project selector and empty state', '2 hours ago', 'RG', 'Ruben', 'main'],
    ['Add keyboard navigation to branch list', 'Yesterday', 'AL', 'Alex', ''],
    ['Fix scroll position on worktree switch', 'Yesterday', 'RG', 'Ruben', 'feature/new-ui'],
    ['Update graph layout for merge commits', '2 days ago', 'MK', 'Maya', ''],
    ['Add repository context menu', '3 days ago', 'RG', 'Ruben', ''],
    ['Improve commit details panel', '4 days ago', 'AL', 'Alex', ''],
    ['Initial project setup', '1 week ago', 'RG', 'Ruben', ''],
  ]
  return <div className="app-scene" aria-label="Vista previa de Git Glam">
    <div className="scene-glow" />
    <div className="app-window">
      <div className="window-bar"><div className="window-dots"><i /><i /><i /></div><div className="window-title"><img src="/logo.svg" alt="" /> git-glam <span>/</span> project</div><div className="window-actions"><span>⌕</span><span>−</span><span>□</span><span>×</span></div></div>
      <div className="app-tabs"><span className="tab-active"><b className="tab-mark">◈</b> git-glam <small>×</small></span><span>orca-git-graph</span><span className="tab-plus">＋</span></div>
      <div className="app-toolbar"><span className="tiny-icon">☰</span><span className="branch-select"><b>⑂</b> All branches <span>⌄</span></span><span className="toolbar-spacer" /><span className="search"><b>⌕</b> Search commits... <kbd>⌘ K</kbd></span><span className="tiny-icon">⟳</span><span className="tiny-icon">⚙</span></div>
      <div className="app-body">
        <aside className="side-panel"><div className="side-heading">REPOSITORY</div><div className="repo-name"><span>▣</span> project-git-branch <span className="muted">⌄</span></div><div className="side-label">⌄ &nbsp; BRANCHES <span>8</span></div><div className="branch-row selected"><i className="branch-blue" /> main <b>●</b></div><div className="branch-row"><i className="branch-pink" /> feature/new-ui</div><div className="branch-row"><i className="branch-violet" /> refactor/graph</div><div className="branch-row"><i className="branch-green" /> fix/scroll-state</div><div className="side-label worktrees">⌄ &nbsp; WORKTREES <span>2</span></div><div className="branch-row"><i className="branch-blue" /> main <em>current</em></div><div className="branch-row"><i className="branch-amber" /> feature/new-ui</div><div className="side-label worktrees">⌄ &nbsp; STASHES <span>1</span></div><div className="branch-row dim-row">◫ &nbsp; WIP: polish toolbar</div></aside>
        <div className="commit-area"><div className="table-header"><span>GRAPH</span><span>MESSAGE</span><span>DATE</span><span>AUTHOR</span></div>
          {commits.map(([message, date, initials, author, branch], index) => <div className="commit-row" key={message}><div className="graph"><i className="lane blue" />{index < 4 && <i className={`lane pink ${index === 5 ? 'short' : ''}`} />}<i className={`node ${index === 2 ? 'pink-node' : 'blue-node'}`} /></div><span className="message"><b>{message}</b>{branch && <label className={`ref ${index === 0 ? 'blue-ref' : 'pink-ref'}`}>{branch}</label>}</span><span className="date">{date}</span><span className="author"><i>{initials}</i> {author}</span></div>)}
          <div className="details-card"><div className="detail-top"><span>Polish project selector and empty state</span><small>2 hours ago · Ruben Glam</small></div><div className="diff-line"><span>−</span> const project = await openRepository()</div><div className="diff-line added"><span>+</span> const project = await selectProject()</div><div className="diff-line added"><span>+</span> showProjectOverview(project)</div></div>
        </div>
      </div>
      <div className="window-status"><span>⑂ main</span><span>● Working tree clean</span><span>7 commits</span></div>
    </div>
    <div className="floating-note"><span className="note-icon">⌘</span><span><b>Todo bajo control</b><small>Ramas, cambios y contexto</small></span><span className="note-check">✓</span></div>
    <div className="scene-caption"><span /> Una vista más clara de tu proyecto</div>
  </div>
}

export default function Home() {
  return <>
    <header className="topbar"><a className="brand" href="#inicio" aria-label="Git Glam, inicio"><img src="/logo.svg" alt="" /><span>git glam<span className="brand-dot">.</span></span></a><nav aria-label="Navegación principal"><a href="#funciones">Funciones</a><a href="#como-funciona">Cómo funciona</a><a className="github-link" href={repository} target="_blank" rel="noreferrer">GitHub <span>↗</span></a></nav><a className="nav-download" href={download}>Descargar <span>↓</span></a></header>
    <main id="inicio">
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> UNA FORMA MÁS CLARA DE VER GIT</div><h1>Tu historial.<br />En su <span>mejor versión.</span></h1><p className="hero-description">Todas tus ramas, commits y cambios en una vista que por fin tiene sentido. Git, sin perderte en el camino.</p><div className="hero-actions"><a className="button-primary" href={download}><span className="windows-icon">⊞</span> Descargar para Windows <span className="download-arrow">↓</span></a><a className="text-link" href={repository} target="_blank" rel="noreferrer">Ver en GitHub <span>↗</span></a></div><div className="requirements"><span className="check">✓</span> Windows 10 o posterior <i>·</i> Gratis y de código abierto</div></div><ProductPreview /><div className="hero-grid" /></section>
      <section className="feature-strip" id="funciones"><div><span className="feature-icon green-icon">⑂</span><span><b>Un grafo que se entiende</b><small>Sigue cada rama y merge de un vistazo.</small></span></div><div><span className="feature-icon purple-icon">⌘</span><span><b>Todo en contexto</b><small>Commits, archivos y diffs en un solo lugar.</small></span></div><div><span className="feature-icon amber-icon">▧</span><span><b>Tus repos, organizados</b><small>Proyectos y worktrees siempre a mano.</small></span></div><div><span className="feature-icon blue-icon">✳</span><span><b>Hecho para Windows</b><small>Ligero, rápido y listo para trabajar.</small></span></div></section>
      <section className="how-section" id="como-funciona"><div className="how-copy"><div className="eyebrow">MENOS FRICCIÓN, MÁS FLUJO</div><h2>Tu repo, a primera vista.</h2><p>Abre un repositorio local y deja que Git Glam ponga cada pieza en su sitio. Sin cuentas, sin configuración complicada.</p></div><div className="how-steps"><div><span>01</span><p><b>Descarga</b><small>Instala Git Glam en unos segundos.</small></p><span className="step-check">✓</span></div><div><span>02</span><p><b>Abre tu proyecto</b><small>Elige cualquier repositorio Git local.</small></p><span className="step-check">✓</span></div><div><span>03</span><p><b>Vuelve a tener el mapa</b><small>Explora ramas, commits y cambios.</small></p><span className="step-check">✓</span></div></div></section>
      <section className="download-banner"><div className="banner-orb" /><div className="banner-copy"><div className="eyebrow"><span className="live-dot" /> GIT GLAM PARA WINDOWS</div><h2>Haz que Git vuelva<br />a tener sentido.</h2><p>Gratis. Código abierto. Tu historial, por fin claro.</p></div><div className="banner-cta"><a className="button-primary" href={download}>↓ &nbsp; Descargar para Windows</a><small>Windows 10 o posterior <span>·</span> Instalador gratuito</small></div></section>
    </main>
    <footer><a className="brand footer-brand" href="#inicio"><img src="/logo.svg" alt="" /><span>git glam<span className="brand-dot">.</span></span></a><span>Hecho para que puedas pensar en tu código.</span><a href={repository} target="_blank" rel="noreferrer">Código abierto en GitHub ↗</a><small>© 2026 Git Glam</small></footer>
  </>
}
