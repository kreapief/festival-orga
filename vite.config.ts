import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './': Die App läuft unter einer Unteradresse wie kreapief.github.io/festival-orga/
// und funktioniert dank Hash-Adressen (#/join/…) ohne Server-Einstellungen.
export default defineConfig({
  base: './',
  plugins: [react()],
})
