# Git Glam

Explorador de historial Git para Windows, construido con Tauri, Rust y React. Reutiliza el algoritmo de carriles de `orca-git-graph` y adapta la paleta y los paneles oscuros de Fenix.

## Requisitos

Node.js 22.18 o posterior, pnpm, Rust con la cadena MSVC, las herramientas de C++ de Visual Studio, WebView2 y Git en el PATH. Instala las dependencias con `pnpm install`.

```sh
pnpm dev              # aplicación de escritorio en desarrollo
pnpm build            # compilar la interfaz React
pnpm typecheck        # comprobar los tipos TypeScript
pnpm test             # ejecutar las pruebas de interfaz y Rust
pnpm package:win      # crear el instalador NSIS para Windows
```

El instalador se genera en `src-tauri/target/release/bundle/nsis/`. En el primer inicio se importan los datos compatibles de instalaciones anteriores: proyectos, ajustes, conversaciones, mejoras, disposición de la interfaz y tokens. Los datos de origen y las credenciales existentes se conservan.

Al iniciar aparece una pantalla para seleccionar uno de los proyectos guardados o añadir un repositorio. Para abrir un proyecto directamente al iniciar, márcalo como **predeterminado** en esa pantalla; vuelve a pulsar la estrella para desactivarlo. El proyecto predeterminado recuerda su último worktree seleccionado. Puedes volver al selector con la pestaña **Proyectos** y cambiar entre proyectos mediante las pestañas superiores.

Arrastra las pestañas de los proyectos para cambiar su orden; también puedes enfocarlas y usar `Alt` con las flechas izquierda o derecha. La pestaña **Proyectos** permanece fija y el orden se conserva al reiniciar.

Los proyectos se guardan entre sesiones. Puedes quitar uno de la lista sin borrar sus archivos. Si un proyecto ya no está disponible, permanece en la lista y se muestra un error al abrirlo; si era el predeterminado, se muestra el selector.

En la pantalla de proyectos puedes crear carpetas para agruparlos y elegir una carpeta para cada proyecto. Las carpetas son una organización dentro de la aplicación y no mueven archivos. Al eliminar una carpeta, sus proyectos vuelven a **Sin carpeta**; la organización se conserva entre sesiones.

El panel izquierdo muestra las ramas locales, los worktrees y los stashes del repositorio; seleccionar un worktree cambia el historial y el estado mostrados. Al seleccionar un stash se muestra su diff de trabajo frente al commit base, sin incluir una comparación independiente del índice ni los archivos sin seguimiento. El panel derecho enumera los archivos con cambios pendientes. Los botones de la barra superior permiten ocultar o mostrar cada panel. Arrastra los separadores para ajustar su ancho; también puedes enfocarlos y usar las flechas, Inicio y Fin.

Abre **Ajustes** desde el icono de la barra superior o el menú Archivo. Puedes elegir el proyecto predeterminado, mostrar u ocultar ramas remotas y cambiar la visibilidad de los paneles; estas preferencias se guardan entre sesiones y se sincronizan con los controles de la vista principal.

En **Ajustes → Comandos** puedes guardar un comando de PowerShell para cada proyecto. El botón **Comando** del grafo lo ejecuta en una ventana de PowerShell desde el worktree seleccionado; las variables `$env:GITGRAPH_PROJECT` y `$env:GITGRAPH_WORKTREE` contienen las rutas del proyecto y del worktree. Por ejemplo, `code .` abre el worktree en VS Code si su comando está disponible. `orca open` inicia Orca, pero no selecciona automáticamente el proyecto. Los comandos se guardan en el archivo local de proyectos y solo se ejecutan al pulsar el botón.

La aplicación muestra hasta 500 commits de las refs locales, incluidas ramas remotas y etiquetas, sus conexiones y el diff del commit seleccionado frente a su primer padre. La búsqueda y la selección de rama atenúan los demás commits para conservar la topología. Actualizar vuelve a leer Git.

Con clic derecho sobre un commit (o `Shift+F10`) puedes crear una etiqueta ligera o una rama, hacer checkout con HEAD separado, cherry-pick, revert, merge, rebase o reset, y copiar su hash o descripción. Las operaciones muestran un diálogo de confirmación; en un merge se elige el padre para cherry-pick o revert. Reset permite elegir soft, mixed o hard. La aplicación muestra los errores de Git y actualiza el estado después de cada intento. Si una operación produce conflictos, Git puede dejarla en curso para resolverla desde otra herramienta o la terminal. El rebase reescribe el historial y reset hard puede descartar cambios rastreados y eliminar archivos sin seguimiento que impidan escribir los archivos del commit.

La aplicación no ejecuta fetch automáticamente. El diff puede mostrar un error si supera el límite de 16 MiB o tarda más de 15 segundos. Requiere Git local y no sigue automáticamente la selección de Orca. El código de cálculo del grafo procede de `orca-git-graph`, distribuido bajo la licencia MIT incluida.

## Actualizaciones

**Ajustes → Acerca de → Buscar actualizaciones** consulta `latest.json` en la última release de GitHub, descarga el instalador firmado y reinicia la aplicación. Solo está activo en la versión instalada.

Para publicar una versión ejecuta `pnpm release 0.2.0 --notes "Qué cambia" --publish`. El script sube la versión en `package.json`, `tauri.conf.json` y `Cargo.toml`, compila y firma el instalador con `~/.tauri/git-glam.key` (o `TAURI_SIGNING_PRIVATE_KEY_PATH`), genera `latest.json` en `release-updates/<versión>/` y, con `--publish`, crea la release en GitHub con `gh`. Sin `--publish` solo prepara los archivos. Haz commit y push del cambio de versión antes de publicar.
