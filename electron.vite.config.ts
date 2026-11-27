import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** React Fast Refresh injects an inline preamble in dev; relax CSP only there. */
function devCsp(): Plugin {
  return {
    name: 'loomlocal-dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), devCsp()]
  }
})
