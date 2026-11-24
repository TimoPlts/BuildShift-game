# BuildShift

BuildShift is a competitive, server-authoritative **multiplayer browser building shooter**. It combines fast third-person combat with tactical, grid-based building, using a regenerating **Energy** resource as the core strategic constraint.

## Game Modes

- **Energy Box Fights** — fast competitive elimination mode (best-of-5 rounds).
- **King of the Tower** — build upward, fight for height, and capture the floating Crystal.

## Technology Stack

| Area | Technology |
| --- | --- |
| Language | TypeScript (strict) |
| 3D engine | Babylon.js |
| Web UI | React + Vite |
| Multiplayer | Colyseus 0.18+ (WebSocket) |
| Server runtime | Node.js |
| Physics | Rapier 3D |
| Monorepo | pnpm workspaces |
| Testing | Vitest (unit), Playwright (E2E) |

## Documentation

- [Game Design](docs/GAME_DESIGN.md)
- [Technical Architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [AI Development Worklog](docs/AI_WORKLOG.md)
- [Architecture Decision Records](docs/adr/README.md)

## Current Status

The playable 1v1 Energy Box Fight includes server-authoritative multiplayer, prep building, editing, combat and an AI Guide. Docker development deployment is validated; production deployment and the production reboot/public-access checks remain to be completed. Match and chat data are intentionally in memory.

## Getting Started

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start the web app (Vite dev server)
pnpm dev:server     # start the game server (TypeScript dev runner)
pnpm build          # build all packages
pnpm typecheck      # typecheck all packages
pnpm test           # run tests
```


## Assignment 12 — Docker deployment

The production stack uses two services: `web` (Nginx + the built React/Babylon
client) and `game` (compiled Node/Colyseus server, Rapier and the 27B AI Guide).
Only `web` publishes a port: **host 8080 → container 80**. Matchmaking, API calls
and WebSocket upgrades are forwarded internally to `game:2567`. Port 2567 is
not published. The browser uses its current origin (`ws` on HTTP, `wss` on
HTTPS), so no player needs our development ports or a Docker service hostname.

The images contain their own code, dependencies, models and documentation.
They use no source bind mounts, Vite dev server or tsx watcher. Node runs as its
non-root `node` user. `restart: always` applies to both persistent services.

### Private configuration and development verification

From the repository root on development:

```bash
cp -n .env.example .env
chmod 600 .env
# Edit .env privately with your editor; set VIVES_LLM_API_KEY.
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

`VIVES_LLM_API_KEY` is the only required private value. Compose passes it only
to `game`, never to the image build or web service. The AI Guide uses
`qwen3.8-27b`; coding workers use a separate configuration. Do not paste keys
in chat, commit `.env`, or publish the resolved output of `docker compose config`.
Use `docker compose config --quiet` for validation without printing values.
Both Git and Docker ignore private environment files; `.env.example` stays public.

Open `http://YOUR-DEVELOPMENT-SERVER:8080` in two browser sessions. Verify that
both players share a match, prep building and elimination work, and requests
stay on port 8080. Test the AI Guide yourself after entering the key. The current
Guide uses an embedded game guide and conversation history: **it has no live
document-retrieval tool**. Do not claim that document lookup was validated.
If separate document lookup is required for grading, that feature remains a
follow-up; copying `docs/` into the backend image alone does not implement it.

To demonstrate independence, stop only the old development/preview processes
when nobody needs them; Docker gameplay must keep working. Browser network
requests must target port 8080, not 5173/5174 or 2567/2568.

### Manual production deployment

Assigned production host: `ai-operations-prod-14`.
Public URL: **https://ai-operations-14.devbitapp.be** (school HTTPS + Authentik).
The school proxy must reach production HTTP port 8080. Our containers do not
manage public TLS certificates or the school's login.

After reviewing, committing and pushing the intended version through the
existing GitHub workflow, connect to the production LXC and check `hostname`.
Authenticate `gh` privately with a separate fine-grained token restricted to
`TimoPlts/BuildShift-game`, Contents read-only, then run `gh auth setup-git`.
Do not put that token in this repository or chat.

```bash
cd /root
gh repo clone https://github.com/TimoPlts/BuildShift-game.git
cd BuildShift-game
# On the first deploy, check out the reviewed deployment branch/commit.
# On later deploys from that branch:
git pull --ff-only
git log -1 --oneline
cp -n .env.example .env
chmod 600 .env
# Enter the production VIVES_LLM_API_KEY privately.
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:8080/healthz
```

Check the public HTTPS URL with a classmate and the AI Guide. Inspect browser
requests for `wss://ai-operations-14.devbitapp.be/...` and same-origin `/api/...`.
A local 8080 success plus a failed public route should be reported to the teacher,
who manages the reverse proxy and Authentik. Closing SSH must not stop the game.

### Reboot recovery, updates and data

Only after confirming `hostname` is **ai-operations-prod-14**, run:

```bash
systemctl enable docker
reboot
```

When production returns, open the public game without manually starting Compose.
Then check `systemctl status docker` and `docker compose ps`. This real reboot and
public login/playtest are required evidence; a container restart alone is not a
completed reboot test. Never reboot the development server for this exercise.

Matches, scores and bounded chat conversations live only in process memory.
Replacing or restarting the game container intentionally resets them. There are
no saved accounts, durable leaderboards or database files, so this stack needs
no volume. The private `.env` remains on each server outside Git and the images.
There is no reason to run `docker compose down -v`.

For future updates, commit/push on development, pull the reviewed version on
production and run `docker compose up -d --build`. A plain `restart` does not
rebuild changed code. GitHub Actions deployment is the next assignment.
