import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { buildCsp } from './src/pwa/csp.ts'

// The light "--ground" token. The manifest needs literal colours, so we repeat it here.
const GROUND = '#e2f3f1'

function productionCsp(): Plugin {
  let policy: string
  return {
    name: 'production-csp',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, 'VITE_SUPABASE_URL')
      policy = buildCsp(env.VITE_SUPABASE_URL)
    },
    transformIndexHtml: {
      order: 'post',
      handler: () => [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      }],
    },
  }
}

// https://vite.dev/config/
// Tailwind CSS v4 uses a CSS-first configuration via @tailwindcss/vite instead of tailwind.config.js.
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'vendor-supabase',
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
            },
            {
              name: 'vendor-data',
              test: /[\\/]node_modules[\\/](ts-fsrs|zod|idb)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    productionCsp(),
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new service worker waits until the user chooses to reload.
      // This avoids swapping code under a user who is in the middle of a review session.
      registerType: 'prompt',
      // We register manually in src/pwa/registerSW.ts so the UI can read the "update available" state.
      injectRegister: false,
      manifest: {
        name: 'ENG-LEARN',
        short_name: 'ENG',
        lang: 'tr',
        display: 'standalone',
        start_url: '/#/bugun',
        scope: '/',
        background_color: GROUND,
        theme_color: GROUND,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // A separate maskable icon: Android crops it to different shapes, so the art keeps a safe margin.
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell (built JS, CSS, HTML and our static icons).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Hash-based routing: every navigation is the same index.html.
        navigateFallback: 'index.html',
        // Never serve the app shell for Supabase endpoints, and never cache them (see below).
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/realtime\//],
        runtimeCaching: [
          {
            // Font CSS from Google changes rarely; show the cached copy and refresh it in the background.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-styles' },
          },
          {
            // The font files themselves are immutable, but the same strategy keeps the config simple.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Supabase calls are intentionally NOT listed: with no matching route, Workbox leaves them
          // to the network. Cached auth or data responses would show stale or another user's data.
        ],
      },
    }),
  ],
})
