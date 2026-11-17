import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Tailwind CSS v4 uses a CSS-first configuration via @tailwindcss/vite instead of tailwind.config.js.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
