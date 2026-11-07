import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowRight, BookOpen, Download, FolderOpen, FolderTree, GitBranch, GitGraph, GitMerge,
  Github, Layers, PanelsTopLeft, RefreshCw, Sparkles, SquareCheckBig,
} from 'lucide-react'

const download = '/download'
const repository = 'https://github.com/rubenglam/git-glam'
const SHOT = { width: 2790, height: 1272 }

const features = [
  { icon: GitGraph, title: 'El grafo, completo', text: 'Ramas, merges y etiquetas en una sola lista, con el HEAD siempre localizado. Filtra por rama o busca un commit concreto.' },
  { icon: Layers, title: 'Ramas, worktrees y stashes', text: 'El panel lateral reúne todo lo que cuelga del repositorio. Cambiar de worktree no obliga a abrir otra ventana.' },
  { icon: SquareCheckBig, title: 'Commit sin salir de la vista', text: 'Prepara cambios, escribe el mensaje y confirma desde el panel derecho, con el grafo siempre a la vista.' },
  { icon: PanelsTopLeft, title: 'Varios proyectos, en pestañas', text: 'Cada repositorio abre en su propia pestaña y recuerda dónde lo dejaste.' },
]

const steps = [
  { icon: Download, title: 'Instala', text: 'Descarga el instalador y ejecútalo. Tarda unos segundos.' },
  { icon: FolderOpen, title: 'Abre una carpeta', text: 'Elige cualquier repositorio que ya uses con Git. No hay cuentas que crear.' },
  { icon: GitBranch, title: 'Trabaja con el mapa delante', text: 'Explora el historial, revisa cambios y confirma desde la misma ventana.' },
]

const extras = [
  { icon: Sparkles, title: 'Mensajes de commit con IA', text: 'Genera una propuesta a partir de tus cambios preparados y edítala antes de confirmar.' },
  { icon: GitMerge, title: 'Resolución de conflictos', text: 'Una vista propia para los ficheros en conflicto durante un merge.' },
  { icon: FolderTree, title: 'Explorador de archivos', text: 'Navega por el árbol del repositorio y abre ficheros sin cambiar de herramienta.' },
  { icon: BookOpen, title: 'Documentación a mano', text: 'Lee el README y los documentos del proyecto desde la propia app.' },
  { icon: RefreshCw, title: 'Actualizaciones integradas', text: 'La app avisa cuando hay una versión nueva y se actualiza desde dentro.' },
]

/** Recorte de la captura real. x, y, w, h son fracciones (0–1) de la imagen. */
function Crop({ x, y, w, h, alt }: { x: number, y: number, w: number, h: number, alt: string }) {
  const style = {
    aspectRatio: `${w * SHOT.width} / ${h * SHOT.height}`,
    '--w': `${100 / w}%`,
    '--tx': `${-x * 100}%`,
    '--ty': `${-y * 100}%`,
  } as CSSProperties
  return <div className="crop" style={style}>
    <img src="/app-screenshot.png" alt={alt} width={SHOT.width} height={SHOT.height} loading="lazy" />
  </div>
}

function Zoom({ title, text, children }: { title: string, text: string, children: ReactNode }) {
  return <figure className="zoom">
    {children}
    <figcaption><b>{title}</b>{text}</figcaption>
  </figure>
}

export default function Home() {
  return <>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Git Glam, inicio"><img src="/logo.svg" alt="" width={26} height={26} />Git Glam</a>
      <nav aria-label="Principal">
        <a href="#detalles">Qué hace</a>
        <a href="#uso">Cómo se usa</a>
        <a href={repository} target="_blank" rel="noreferrer">Código fuente</a>
        <a className="nav-download" href={download}>Descargar</a>
      </nav>
    </header>

    <main id="top">
      <section className="hero">
        <h1>Un cliente de Git para Windows que enseña tu historial tal como es.</h1>
        <p className="lead">Git Glam abre un repositorio local y dibuja su grafo de commits, sus ramas y tus cambios pendientes en una sola ventana. Sin cuenta y sin configurar nada.</p>
        <div className="actions">
          <a className="button" href={download}><Download size={18} aria-hidden /> Descargar para Windows</a>
          <a className="link" href={repository} target="_blank" rel="noreferrer"><Github size={18} aria-hidden /> Ver en GitHub</a>
        </div>
        <p className="note">Windows 10 o posterior · Gratuito y de código abierto</p>
      </section>

      <figure className="shot">
        <img
          src="/app-screenshot.png"
          {...SHOT}
          alt="Git Glam mostrando el historial de su propio repositorio: lista de commits con etiquetas de versión, panel de ramas a la izquierda y control de código fuente a la derecha."
          fetchPriority="high"
        />
        <figcaption>Git Glam abierto sobre su propio repositorio.</figcaption>
      </figure>

      <section className="details" id="detalles">
        <h2>Lo esencial, bien resuelto</h2>
        <p className="section-lead">Lo que haces con Git cada día, sin saltar entre terminal, editor y navegador.</p>
        <ul className="features">
          {features.map(({ icon: Icon, title, text }) => <li key={title}>
            <span className="icon"><Icon size={20} aria-hidden /></span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>)}
        </ul>
      </section>

      <section className="zooms" aria-label="Detalles de la interfaz">
        <Zoom title="Cada commit, con su contexto" text="Etiquetas de versión, ramas locales y remotas, autor, fecha y hash en la misma fila.">
          <Crop x={0.222} y={0.0} w={0.58} h={0.3} alt="Detalle de la lista de commits con el HEAD resaltado y etiquetas de versión." />
        </Zoom>
        <div className="zoom-pair">
          <Zoom title="Todo el repositorio, a un lado" text="Ramas, worktrees, stashes y etiquetas con filtro rápido.">
            <Crop x={0} y={0.0} w={0.222} h={0.55} alt="Panel lateral con ramas, worktrees y stashes." />
          </Zoom>
          <Zoom title="Prepara y confirma" text="Cambios preparados y sin preparar, con el estado de cada archivo.">
            <Crop x={0.805} y={0.0} w={0.195} h={0.55} alt="Panel de control de código fuente con archivos preparados y cambios." />
          </Zoom>
        </div>
      </section>

      <section className="how" id="uso">
        <h2>Cómo se usa</h2>
        <ol>
          {steps.map(({ icon: Icon, title, text }, i) => <li key={title}>
            <span className="step-num">{i + 1}</span>
            <span className="icon"><Icon size={20} aria-hidden /></span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>)}
        </ol>
      </section>

      <section className="extras">
        <h2>Y además</h2>
        <ul>
          {extras.map(({ icon: Icon, title, text }) => <li key={title}>
            <Icon size={18} aria-hidden />
            <div><b>{title}</b><p>{text}</p></div>
          </li>)}
        </ul>
      </section>

      <section className="closing">
        <div>
          <h2>Pruébalo con tu repositorio.</h2>
          <p>La instalación son unos segundos. Abre cualquier carpeta que ya use Git y empieza.</p>
        </div>
        <a className="button" href={download}>Descargar para Windows <ArrowRight size={18} aria-hidden /></a>
      </section>
    </main>

    <footer>
      <span>© 2026 Git Glam</span>
      <a href={repository} target="_blank" rel="noreferrer">GitHub</a>
    </footer>
  </>
}
