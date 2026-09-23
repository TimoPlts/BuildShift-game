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

**Architecture / pre-development phase.** The monorepo foundation has been scaffolded (workspace, shared TypeScript config, web app, game server package, and shared packages). Gameplay, networking, and persistence are not yet implemented.

## Getting Started

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start the web app (Vite dev server)
pnpm dev:server     # start the game server (TypeScript dev runner)
pnpm build          # build all packages
pnpm typecheck      # typecheck all packages
pnpm test           # run tests
```
