# The Button

3D web experience, live at https://asoma.duckdns.org/button/ (public, PWA).

- Deploy: `npm run build` → copy `dist/` to `/var/www/button` on the box (scp to /tmp first, then `sudo` copy).
- When adding content, update `content-graph.ts` (see memory `the-button-content-map.md`).

## Part of ASOMA

Runs on the ASOMA hub (Oracle box `ubuntu@92.5.27.26`, asoma.duckdns.org). Hub-wide facts live in the
`Chriscross475/asoma-hub` repo: `RUNBOOK.md` (services, ports, deploy recipes) and `infra/platform.yml`.

- **Shared memory** (on the user's PC): `\\wsl.localhost\Ubuntu\home\asoma\.claude\projects\-home-asoma\memory\`
  — read `MEMORY.md` and `project-the-button.md`, `the-button-deploy.md`; save new facts there, not in per-folder memory.
- **SSH** keys live in WSL (`~/.ssh/oracle.key`); from Windows: `wsl.exe -d Ubuntu -- ssh -i /home/asoma/.ssh/oracle.key ubuntu@92.5.27.26`.
- **GitHub is the source of truth.** Check `git status`/`git log` against origin before editing; the box checkout and WSL clones can differ.
- Deploying or restarting is a production action — say what will change first. Never commit or push unless asked; no Co-Authored-By lines.
