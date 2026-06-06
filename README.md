# The Button

A first-person comedic web game — a dry, Stanley-Parable-style narrator and one
very tempting button. Pressing it transforms the white room in place into one of
several **experiences** (ducks, a forest, a train tunnel, doors, the button gag,
a trainyard slingshot, hoops, a circus…), each with its own gag and an exit back
to a fresh room.

Built with **TypeScript + Three.js + Vite** — all geometry is code-generated, no
binary assets (except `public/quack.mp3`). Desktop (mouse-look + WASD) and mobile
(touch joystick + tap) controls ship together.

## Run

```sh
npm install
npm run dev      # http://localhost:5173/  (also LAN + Cloudflare-tunnel friendly)
npm run build    # → dist/  (built with base '/button/' for the Oracle deploy)
```

## Narrator (TTS)

The narrator uses the server-side **Kokoro** voice (`bm_george`) via `POST /api/tts`
— the same backend the Sandbox UI uses — played through a plain `<audio>`. In dev,
Vite proxies `/api/tts` → `localhost:37777`; in production Caddy routes it to the
Oracle Sandbox server. A **VOICE: KOKORO / BASIC** menu toggle switches to the
browser's Web Speech voice, which is also the automatic fallback.

## Deploy

Static build, served by Caddy on the Oracle box at `asoma.duckdns.org/button/`:

```sh
npm run build
scp -r dist/* ubuntu@<oracle>:/tmp/tb/ && \
  ssh ubuntu@<oracle> 'sudo rm -rf /var/www/button && sudo mkdir -p /var/www/button && \
  sudo cp -r /tmp/tb/* /var/www/button/ && sudo chmod -R a+rX /var/www/button'
```

🔴 Press the button.
