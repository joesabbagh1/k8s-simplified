import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Adds the Cloudflare Web Analytics beacon to production builds, when VITE_CF_BEACON_TOKEN is set. */
function cloudflareAnalytics(): Plugin {
  let token = ''
  return {
    name: 'cloudflare-analytics',
    apply: 'build',
    configResolved(config) {
      token = config.env.VITE_CF_BEACON_TOKEN?.trim() ?? ''
    },
    transformIndexHtml() {
      if (!token) return
      return [
        {
          tag: 'script',
          attrs: {
            type: 'module',
            src: 'https://static.cloudflareinsights.com/beacon.min.js',
            'data-cf-beacon': JSON.stringify({ token }),
          },
          injectTo: 'body',
        },
      ]
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflareAnalytics()],
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than lessons, so they get their own long-cached files.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'ui-sdk', test: /node_modules[\\/]@ui-sdk[\\/]/ },
          ],
        },
      },
    },
  },
})
