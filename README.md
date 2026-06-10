# The Button

A first-person comedic web game — a dry, Stanley-Parable-style narrator and one
very tempting button. Pressing it transforms the white room in place into one of
several **experiences** (ducks, a forest, a train tunnel, doors, the button gag,
a trainyard slingshot, hoops, a circus…), each with its own gag and an exit back
to a fresh room.

Built with **TypeScript + Three.js + Vite** — all geometry is code-generated; the
only binary assets are audio (`public/quack.mp3` + the pre-baked narration in
`public/vo/`). Desktop (mouse-look + WASD) and mobile (touch joystick + tap)
controls ship together.

## Run

```sh
npm install
npm run dev      # http://localhost:5173/  (also LAN + Cloudflare-tunnel friendly)
npm run build    # → dist/  (built with base '/button/' for the Oracle deploy)
```

## Narrator (TTS)

Narration is **pre-baked to static WAV assets** (`public/vo/<hash>.wav`) and played
directly at runtime — instant, with zero server inference. Generate them with:

```sh
npm run vo      # needs the local Sandbox kokoro at localhost:37777
```

`scripts/generate-vo.ts` scans the source for `narrate('...')` lines, synthesises each
(kokoro `bm_george`, with the per-phrase pauses baked in), and writes a content-hashed
WAV plus a manifest (`src/audio/vo-manifest.json`, imported by the runtime). Only
new/changed lines regenerate; stale WAVs are pruned. Run it locally where kokoro is
fast, then **commit** `public/vo/*.wav` + the manifest.

At runtime a fixed line plays its bundled WAV; anything not baked — dynamic lines, or a
missing asset — falls back to the live `POST /api/tts` kokoro (Vite proxies it to
`localhost:37777` in dev; Caddy routes it to the Oracle server in prod), then to the
browser's Web Speech voice. Keep spoken lines as fixed
string literals so they all pre-bake; lines stored in consts/arrays (rotation
pools, death lines) must be wrapped in `vo(...)` (src/audio/vo-shared.ts) so the
scanner finds them.

## Deploy

Static build, served by Caddy on the Oracle box at `asoma.duckdns.org/button/`:

```sh
npm run build
scp -r dist/* ubuntu@<oracle>:/tmp/tb/ && \
  ssh ubuntu@<oracle> 'sudo rm -rf /var/www/button && sudo mkdir -p /var/www/button && \
  sudo cp -r /tmp/tb/* /var/www/button/ && sudo chmod -R a+rX /var/www/button'
```

🔴 Press the button.
