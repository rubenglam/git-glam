import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({ base: './', plugins: [react()], define: { __APP_VERSION__: JSON.stringify(version) }, build: { rollupOptions: { input: { app: new URL('./index.html', import.meta.url).pathname, landing: new URL('./landing.html', import.meta.url).pathname } } }, server: { watch: { ignored: ['**/src-tauri/target/**'] } } })
