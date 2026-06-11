import { defineConfig } from 'vite';
import { resolve } from 'path';

// Plain Vite. No base path (served at root in dev); add `base` later if we
// deploy to a sub-path. `host: true` exposes the LAN URL so a phone on the
// same WiFi can open the dev build — the engine ships both desktop + touch
// controls.
export default defineConfig(({ command }) => ({
  // Dev serves at root (local + tunnel); the production build is served under
  // /button/ on the Oracle box, so asset URLs need that base only when building.
  base: command === 'build' ? '/button/' : '/',
  // Two pages: the game (index.html) and the content map (graph.html, served at
  // /button/graph.html). Same origin → they share discovery progress.
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), graph: resolve(__dirname, 'graph.html') } } },
  // host: LAN URL for same-WiFi phones; allowedHosts: true so a Cloudflare quick
  // tunnel (*.trycloudflare.com) can proxy the dev server for remote playtesting.
  // Local dev: proxy the narrator TTS to the local Sandbox server (port 37777).
  // In production /api/tts is served by Caddy → the Oracle Sandbox backend.
  server: { host: true, allowedHosts: true, proxy: { '/api/tts': 'http://localhost:37777' } },
}));
