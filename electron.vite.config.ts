import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The same alias has to be declared for all three targets; electron-vite builds
// them as independent Rollup passes and they do not inherit resolve config.
const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(`v${pkg.version}`)
    },
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react()]
  }
})
