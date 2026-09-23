# Technical Architecture — Competitive Browser Building Shooter

> **Status:** Architecture baseline / source of truth  
> **Project:** Competitive multiplayer browser building shooter  
> **Game modes:** Energy Box Fights + King of the Tower  
> **Purpose:** Prevent architecture drift during AI-assisted development and define what belongs on the client, server, shared simulation, database, and test layers.

---

# 1. Architecture Goals

The technical architecture must support a competitive real-time 3D browser game with:

- Fast third-person movement
- Server-authoritative multiplayer
- Client-side prediction
- Remote-player interpolation
- Shooting and hit validation
- Grid-based building
- Build destruction
- Regenerating building energy
- Multiple game modes
- Round resets
- Reconnection
- Matchmaking later
- Persistent accounts and rankings later
- Automated testing
- AI-assisted development without allowing the codebase to become inconsistent

The architecture should be sophisticated enough for a third-year AI & Software project while remaining realistic within approximately 12 development lessons.

The main principle is:

> **The client makes the game feel immediate. The server decides what is true.**

---

# 2. Locked Technology Decisions

These choices form the default technical direction.

| Area | Technology | Decision |
|---|---|---|
| Language | TypeScript | Locked |
| 3D engine | Babylon.js | Locked |
| Web UI | React | Locked |
| Build tooling | Vite | Locked |
| Multiplayer framework | Colyseus 0.18+ | Locked |
| Transport | WebSocket through Colyseus | Locked |
| Server runtime | Node.js | Locked |
| Physics/collision | Rapier 3D | Initial choice |
| Package manager | pnpm | Locked |
| Repository | pnpm monorepo | Locked |
| Unit/integration testing | Vitest | Locked |
| Browser/E2E testing | Playwright | Locked |
| Database | PostgreSQL | Later phase |
| DB access | Drizzle ORM | Initial choice |
| CI | GitHub Actions | Planned |
| Containerization | Docker | Planned |
| Deployment | Static web client + persistent Node game server | Planned |

---

# 3. Why Babylon.js

Babylon.js will be responsible for the actual 3D game client.

Babylon handles:

- 3D scene rendering
- Cameras
- Meshes
- Materials
- Lighting
- Animation
- Scene picking
- Audio
- Particle effects
- Debug rendering
- Asset loading
- WebGL/WebGPU abstraction

React should **not** control the 3D world.

React is used for application UI such as:

- Main menu
- Login
- Lobby
- Matchmaking
- Game mode selection
- Settings
- Profile
- Ranking
- Match history
- Leaderboards
- HUD overlays where appropriate

The Babylon render loop must remain independent from React rendering.

---

# 4. Why Colyseus

Colyseus will provide the multiplayer foundation.

We specifically want the Colyseus 0.18+ netcode model because it supports:

- Authoritative server rooms
- Fixed-timestep simulation
- Server-validated input
- Client-side prediction
- Reconciliation
- Remote-player interpolation
- State synchronization
- Reconnection
- Matchmaking
- Rewind support for lag-compensated hit checks

We should use those systems rather than manually rebuilding all multiplayer infrastructure with raw WebSockets.

Colyseus is responsible for multiplayer infrastructure.

It is **not** responsible for game design.

Our code still defines:

- Player movement rules
- Weapon behavior
- Damage
- Building
- Energy
- Rounds
- Objectives
- Box Fight logic
- King of the Tower logic
- Ranking rules

---

# 5. High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         BROWSER                             │
│                                                             │
│  ┌────────────────────┐        ┌─────────────────────────┐  │
│  │       React        │        │      Babylon.js         │  │
│  │                    │        │                         │  │
│  │ Menus              │        │ World Rendering         │  │
│  │ Lobby              │        │ Characters              │  │
│  │ HUD                │        │ Builds                  │  │
│  │ Profile            │        │ Weapons                 │  │
│  │ Rankings           │        │ Camera                  │  │
│  └─────────┬──────────┘        │ Effects                 │  │
│            │                   └───────────┬─────────────┘  │
│            │                               │                │
│            └────────────┬──────────────────┘                │
│                         ▼                                   │
│                 Client Game Runtime                         │
│                                                             │
│                 Input / Prediction                          │
│                 Reconciliation                              │
│                 Interpolation                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          │ WebSocket
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    COLYSEUS GAME SERVER                     │
│                                                             │
│ Match / Room Management                                     │
│ Authoritative Simulation                                    │
│ Input Validation                                            │
│ Movement                                                    │
│ Combat                                                      │
│ Building                                                    │
│ Energy                                                      │
│ Round Logic                                                 │
│ Objective Logic                                             │
│ Reconnection                                                │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
              Match result / persistent data only
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       POSTGRESQL                            │
│                                                             │
│ Accounts                                                    │
│ Player Profiles                                             │
│ Ratings                                                     │
│ Match History                                               │
│ Statistics                                                  │
│ Leaderboards                                                │
└─────────────────────────────────────────────────────────────┘
```

---

# 6. Repository Structure

The project should use a monorepo from the beginning.

Recommended structure:

```text
project-root/
│
├── apps/
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── routes/
│   │   │   │   ├── pages/
│   │   │   │   └── providers/
│   │   │   │
│   │   │   ├── game/
│   │   │   │   ├── bootstrap/
│   │   │   │   ├── scene/
│   │   │   │   ├── player/
│   │   │   │   ├── camera/
│   │   │   │   ├── weapons/
│   │   │   │   ├── building/
│   │   │   │   ├── effects/
│   │   │   │   ├── audio/
│   │   │   │   └── debug/
│   │   │   │
│   │   │   ├── network/
│   │   │   │   ├── colyseus/
│   │   │   │   ├── prediction/
│   │   │   │   └── interpolation/
│   │   │   │
│   │   │   ├── ui/
│   │   │   │   ├── hud/
│   │   │   │   ├── lobby/
│   │   │   │   └── menus/
│   │   │   │
│   │   │   └── main.tsx
│   │   │
│   │   └── package.json
│   │
│   └── game-server/
│       ├── src/
│       │   ├── rooms/
│       │   │   ├── BoxFightRoom.ts
│       │   │   └── KingOfTowerRoom.ts
│       │   │
│       │   ├── match/
│       │   │   ├── MatchLifecycle.ts
│       │   │   ├── RoundManager.ts
│       │   │   └── SpawnManager.ts
│       │   │
│       │   ├── simulation/
│       │   ├── validation/
│       │   ├── persistence/
│       │   ├── matchmaking/
│       │   └── server.ts
│       │
│       └── package.json
│
├── packages/
│   │
│   ├── protocol/
│   │   ├── src/
│   │   │   ├── inputs/
│   │   │   ├── messages/
│   │   │   ├── schemas/
│   │   │   ├── events/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── simulation/
│   │   ├── src/
│   │   │   ├── movement/
│   │   │   ├── physics/
│   │   │   ├── combat/
│   │   │   ├── building/
│   │   │   ├── energy/
│   │   │   ├── math/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── game-config/
│   │   ├── src/
│   │   │   ├── weapons.ts
│   │   │   ├── movement.ts
│   │   │   ├── builds.ts
│   │   │   ├── energy.ts
│   │   │   ├── networking.ts
│   │   │   └── modes.ts
│   │   └── package.json
│   │
│   └── database/
│       ├── src/
│       ├── migrations/
│       └── package.json
│
├── docs/
│   ├── GAME_DESIGN.md
│   ├── TECHNICAL_ARCHITECTURE.md
│   ├── NETWORK_PROTOCOL.md
│   ├── AI_WORKLOG.md
│   └── adr/
│
├── tests/
│   └── e2e/
│
├── .github/
│   └── workflows/
│
├── docker/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

# 7. Package Responsibilities

The package boundaries are important.

AI coding tools must respect them.

---

## 7.1 `apps/web`

Contains browser-only code.

Allowed:

- Babylon rendering
- Keyboard/mouse input
- Camera
- Audio
- Visual effects
- React UI
- Network client
- Prediction presentation
- Interpolation presentation

Not allowed:

- Deciding authoritative damage
- Deciding if a build is valid
- Deciding who won
- Changing authoritative health
- Giving itself energy
- Updating rank/MMR directly
- Trusting client-owned game results

---

## 7.2 `apps/game-server`

Contains server-only code.

Responsible for:

- Creating game rooms
- Player join/leave
- Reconnection
- Match lifecycle
- Authoritative simulation
- Validating inputs
- Authoritative health
- Authoritative energy
- Build placement validation
- Weapon validation
- Hit validation
- Round scoring
- Match scoring
- Crystal scoring
- Final match results

The server decides what is true.

---

## 7.3 `packages/protocol`

Contains the network contract shared by client and server.

Examples:

- Input schemas
- Colyseus state schemas
- Network event names
- Message payload types
- Game mode identifiers
- Build identifiers
- Weapon identifiers

This package must **not** contain Babylon code, React code, database code, or Node-only code.

---

## 7.4 `packages/simulation`

Contains game simulation rules that can safely run on both server and client.

This package is extremely important for prediction.

Examples:

- Movement stepping
- Velocity calculations
- Gravity
- Jump rules
- Energy regeneration math
- Grid snapping math
- Weapon timing calculations
- Cooldown calculations
- Pure collision helpers
- Deterministic math utilities

The client can use the same movement step for prediction that the server uses for authority.

This package should contain as little platform-specific code as possible.

---

## 7.5 `packages/game-config`

Contains shared configuration.

Example:

```text
PLAYER_SPEED
JUMP_SPEED
GRAVITY

WALL_ENERGY_COST
RAMP_ENERGY_COST
FLOOR_ENERGY_COST

WALL_MAX_HP
RAMP_MAX_HP

SHOTGUN_DAMAGE
SHOTGUN_FIRE_INTERVAL

BOX_FIGHT_ROUNDS_TO_WIN

CRYSTAL_CAPTURE_SECONDS
```

Do not scatter gameplay values across dozens of files.

Balance values should be centralized.

---

## 7.6 `packages/database`

Added once persistence becomes necessary.

Responsible for:

- Drizzle schema
- Database migrations
- Repository functions
- Match persistence
- Player statistics
- Ranking persistence

The live game loop must not depend on database reads/writes every tick.

---

# 8. Dependency Direction

Dependencies should generally flow inward toward shared logic.

```text
apps/web
   │
   ├──────────────► packages/protocol
   ├──────────────► packages/simulation
   └──────────────► packages/game-config


apps/game-server
   │
   ├──────────────► packages/protocol
   ├──────────────► packages/simulation
   ├──────────────► packages/game-config
   └──────────────► packages/database


packages/simulation
   │
   └──────────────► packages/game-config


packages/protocol
   └── should remain independent


packages/database
   └── should not be imported by the web client
```

Avoid circular dependencies.

---

# 9. Client / Server Authority Rules

This is one of the most important architecture rules.

---

## Client Owns

The client owns presentation and player intent.

Examples:

- Keyboard state
- Mouse state
- Camera rotation
- Local animations
- Sound effects
- Build ghost preview
- Crosshair
- Local immediate movement prediction
- Menu state

---

## Server Owns

The server owns gameplay truth.

Examples:

- Player position authority
- Player health
- Shield
- Energy
- Ammo
- Fire cooldown
- Build existence
- Build health
- Build ownership
- Damage
- Eliminations
- Spawn
- Round score
- Crystal capture
- Match result
- Rating result

---

# 10. Never Trust These Client Claims

The client must never send messages equivalent to:

```text
"I am at position X."
"I dealt 85 damage."
"I killed player B."
"I have 100 energy."
"I placed this wall successfully."
"I captured the crystal."
"I won the match."
"My rating increased by 30."
```

Instead the client sends **intent**.

Example:

```text
"I am holding W and D."
"I pressed jump."
"I fired weapon slot 1 at this moment."
"I want to place a wall in this candidate build slot."
"I am interacting with the objective."
```

The server determines the result.

---

# 11. Simulation Tick Model

Initial architecture:

```text
Authoritative input/simulation tick: 30 Hz
Physics substeps:                  2
Effective physics stepping:       60 Hz
Client render rate:                monitor dependent
State patch/broadcast rate:        begin around 20 Hz
```

These values are starting points, not permanent balance constants.

---

## Why 30 Hz Simulation

30 authoritative input steps per second is a reasonable starting point for a browser-based competitive game.

It gives:

- Predictable fixed timestep
- Lower server load than 60 Hz
- Sufficient responsiveness when combined with client prediction
- Clear architecture for testing

Physics can use two substeps per simulation step if required.

```text
Simulation Tick 1
├── Apply player input once
├── Physics substep A
└── Physics substep B

Simulation Tick 2
├── Apply player input once
├── Physics substep A
└── Physics substep B
```

Never apply the same input twice because physics uses substeps.

---

# 12. Rendering Is Not Simulation

Babylon may render at:

```text
60 FPS
120 FPS
144 FPS
240 FPS
```

The authoritative simulation should still run at its fixed rate.

Do not tie movement rules to browser frame rate.

Bad:

```ts
position.x += speed;
```

Correct concept:

```ts
position.x += speed * fixedDeltaTime;
```

---

# 13. Player Input Model

The client sends inputs, not transforms.

Conceptual input frame:

```ts
type PlayerInput = {
  sequence: number;

  moveX: number;
  moveZ: number;

  lookYaw: number;
  lookPitch: number;

  jump: boolean;
  sprint: boolean;
  crouch: boolean;

  primaryFire: boolean;
  secondaryFire: boolean;
};
```

The exact wire schema should use compact primitive values supported by the multiplayer input system.

---

# 14. Input Sequence Numbers

Every input has a monotonically increasing sequence/tick identity.

Example:

```text
Input 381
Input 382
Input 383
Input 384
```

The client predicts these immediately.

The server processes them authoritatively.

When authoritative state returns, the client knows which inputs the server already processed.

It can then:

1. Accept authoritative position
2. Remove acknowledged inputs
3. Reapply remaining local inputs
4. Smooth small corrections

This is the basis of reconciliation.

---

# 15. Local Player Prediction

Without prediction:

```text
Press W
   ↓
Network request
   ↓
Server processes
   ↓
Network response
   ↓
Character moves
```

This would feel delayed.

With prediction:

```text
Press W
   │
   ├──► Predict movement immediately
   │
   └──► Send input to server
              │
              ▼
       Server simulates
              │
              ▼
        Authoritative state
              │
              ▼
          Reconcile
```

The local player should therefore feel responsive even with network latency.

---

# 16. Remote Player Interpolation

Other players are not predicted using local input because their input is unknown.

Instead the client keeps a small interpolation buffer.

Conceptually:

```text
Server state A ------- Server state B ------- Server state C

                         render here
                              ▲
```

The client renders slightly behind the newest server state and interpolates between known snapshots.

This produces smoother remote movement.

---

# 17. Physics Architecture

Initial physics choice: **Rapier 3D**.

Rapier should be used for:

- Player capsule collision
- Static arena collision
- Build collision
- Ramp collision
- Ground detection
- Shape casts
- Raycasts
- Potential projectile collision where appropriate

For the player, prefer a **kinematic character controller** rather than a fully dynamic ragdoll-style rigid body.

This provides much better control for competitive movement.

---

# 18. Physics and Prediction Rule

Client and server must use the same relevant movement rules.

The goal is not that the browser becomes authoritative.

The goal is:

```text
same input
+
same starting state
+
same step
≈
same predicted result
```

Small differences are corrected by reconciliation.

Physics versions and relevant configuration must therefore stay synchronized between client and server.

---

# 19. Player Collision Shape

Initial player collider:

```text
Capsule
```

Why:

- Good for stairs/slopes
- Smooth movement around corners
- Common for character controllers
- Cheaper and more stable than using a complex character mesh

The visible character model should never be used as the actual collision body.

---

# 20. Rotation

The physics body does not need to physically rotate like a dynamic object.

Store:

```text
yaw
pitch
```

separately.

Yaw determines horizontal facing.

Pitch mainly affects aiming/camera.

The rendered character can rotate visually.

---

# 21. Building Grid Architecture

Building should not use arbitrary free-form positions.

The world uses a logical build grid.

Conceptual placement key:

```ts
type BuildSlot = {
  gridX: number;
  gridY: number;
  gridZ: number;
  orientation: number;
  slotType: BuildSlotType;
};
```

A unique normalized build-slot key can look conceptually like:

```text
8:3:12:NORTH:WALL
```

This makes it easy to:

- Detect duplicates
- Validate occupancy
- Synchronize builds
- Reset arenas
- Store ownership
- Test placement rules

---

# 22. Build Types

Initial types:

```text
WALL
FLOOR
RAMP
```

Later:

```text
CONE / ROOF
```

Editing should come after the base building system is stable.

---

# 23. Build Preview Flow

The client performs **non-authoritative preview logic** for responsiveness.

```text
Camera ray
   ↓
Find candidate surface
   ↓
Snap to logical grid
   ↓
Render translucent preview
```

Example:

```text
Green preview → probably valid
Red preview   → locally invalid
```

This is visual feedback only.

The server performs the final validation.

---

# 24. Build Request Flow

```text
Client
  │
  │ BuildRequest
  ▼
Server
  │
  ├── Is player alive?
  ├── Is match accepting builds?
  ├── Is requested type valid?
  ├── Is candidate slot reachable?
  ├── Is slot occupied?
  ├── Is placement colliding illegally?
  ├── Is player allowed to build here?
  ├── Enough energy?
  └── Build rate allowed?
         │
         ▼
      ACCEPT
         │
         ├── Deduct energy
         ├── Create authoritative build
         ├── Create collider
         └── State sync to clients
```

If rejected:

```text
Server rejects request
        ↓
Client removes/reverts predicted preview
```

Initially, build placement itself does not need full optimistic prediction.

Fast preview + quick authoritative confirmation may be enough.

We should only add build prediction if real testing shows it is required.

---

# 25. Build Entity

Conceptually:

```ts
BuildEntity {
  id
  type

  gridX
  gridY
  gridZ
  orientation

  ownerPlayerId
  ownerTeamId

  health
  maxHealth

  buildProgress

  createdTick
}
```

Build entities are authoritative server objects.

---

# 26. Build Energy

Energy is server-owned.

Example configuration:

```text
MAX_ENERGY = 100

WALL_COST  = 20
FLOOR_COST = 15
RAMP_COST  = 20

ENERGY_REGEN_PER_SECOND = 10
```

The shared simulation package may calculate regeneration.

Only the server changes authoritative energy.

The client renders the synchronized energy value and may visually estimate smooth regeneration between patches.

---

# 27. Build Construction

Structures may gradually gain health.

Example:

```text
Spawned        50 HP
+0.5 sec      100 HP
+1.0 sec      200 HP
+1.5 sec      300 HP
+2.0 sec      400 HP
```

This should be driven by server simulation time/ticks.

Do not use arbitrary browser `setTimeout()` calls as authoritative game logic.

---

# 28. Build Destruction

Flow:

```text
Weapon hits build
       ↓
Server validates hit
       ↓
Server applies damage
       ↓
HP <= 0?
       ↓
Remove build entity
       ↓
Remove physics collider
       ↓
State patch sent
       ↓
Clients play destruction effect
```

Visual debris should be client-side only.

We should not synchronize every debris particle.

---

# 29. Weapons Architecture

Weapons should be data-driven.

Example configuration:

```ts
SHOTGUN = {
  fireIntervalMs: ...,
  pelletCount: ...,
  damagePerPellet: ...,
  maxRange: ...,
  magazineSize: ...,
  reloadTimeMs: ...
}
```

Client and server may both read weapon configuration.

Only the server applies authoritative combat results.

---

# 30. Hitscan First

Initial weapons should use hitscan.

Recommended MVP:

- Shotgun
- Assault Rifle

Avoid physical bullet simulation initially.

Hitscan means:

```text
Fire input
   ↓
Server validates weapon state
   ↓
Server ray/shape cast
   ↓
Determine hit
   ↓
Apply damage
```

Visual tracers can still be rendered client-side.

---

# 31. Shotgun Model

The shotgun may perform multiple pellet traces.

Conceptually:

```text
shot origin
   ├──── pellet
   ├──── pellet
   ├──── pellet
   ├──── pellet
   ├──── pellet
   └──── pellet
```

Spread generation must be reproducible/controlled enough that the server is authoritative.

Do not let the client report individual pellet hits.

---

# 32. Fire Validation

Server checks:

```text
Player alive?
Correct weapon equipped?
Enough ammo?
Reloading?
Fire cooldown complete?
Match currently active?
Input rate valid?
```

Only then does the server process the shot.

---

# 33. Lag Compensation / Rewind

This should be considered an advanced multiplayer feature after baseline combat works.

Problem:

At 80 ms latency, the player may shoot at where an opponent appeared on their screen, but the opponent has already moved on the server.

Possible server flow:

```text
Client fires
    ↓
Server receives fire input
    ↓
Determine relevant historical shot time
    ↓
Rewind target hitboxes
    ↓
Perform hit check
    ↓
Restore current simulation
    ↓
Apply result
```

Colyseus 0.18 provides rewind-oriented functionality that can help support this model.

For MVP:

1. Implement server-authoritative hitscan first.
2. Measure how it feels under simulated latency.
3. Add rewind/lag compensation when needed.

Do not begin the project by implementing complex lag compensation.

---

# 34. Match Room Design

We have two main game modes.

Recommended server rooms:

```text
BoxFightRoom
KingOfTowerRoom
```

They can share reusable systems.

Do **not** copy/paste movement, combat, and building logic between rooms.

Shared systems:

```text
PlayerSystem
MovementSystem
CombatSystem
BuildingSystem
EnergySystem
SpawnSystem
RoundSystem
```

Game-mode-specific logic stays in each mode.

---

# 35. Match State Machine

Every match should have explicit states.

Example:

```text
WAITING
   ↓
COUNTDOWN
   ↓
ROUND_ACTIVE
   ↓
ROUND_END
   ↓
ROUND_RESET
   ↓
COUNTDOWN
   ↓
...
   ↓
MATCH_END
```

Never infer the match phase from random booleans like:

```text
isStarted
isFinished
isResetting
isWaiting
```

Use a single explicit state machine.

---

# 36. Box Fight Mode State

Authoritative state includes:

```text
players
builds
roundNumber
roundScore
matchPhase
roundTimer
winnerId
```

Round end:

```text
One player/team remains
        ↓
Round winner assigned
        ↓
Score updated
        ↓
ROUND_END
        ↓
Clear builds
        ↓
Reset players
        ↓
Next round
```

---

# 37. King of the Tower State

Additional state:

```text
crystalState
capturePlayerId
captureProgress
score
```

Crystal flow:

```text
No player in zone
      ↓
Player enters
      ↓
Capture progress
      ↓
Opponent enters
      ↓
CONTESTED
      ↓
One player remains
      ↓
Capture continues
      ↓
Threshold reached
      ↓
Point awarded
```

The server determines who is inside the capture area.

The client only displays the state.

---

# 38. Round Reset Strategy

Round reset should be deterministic and centralized.

Reset should:

```text
Remove all temporary builds
Reset physics colliders
Reset player positions
Reset player HP
Reset shield
Reset energy
Reset ammo
Reset crystal state
Clear transient effects/state
Increment round where appropriate
```

Do not scatter reset logic throughout unrelated classes.

Use one controlled match/round reset path.

---

# 39. Colyseus State vs Messages

Use synchronized room state for data that represents current world truth.

Examples:

```text
Player position
Player HP
Energy
Build entities
Score
Round state
Crystal progress
```

Use messages/events for short-lived events.

Examples:

```text
Shot fired effect
Hit confirmation
Round-start cue
Error/rejection
UI notification
Build rejected
```

Avoid sending huge state objects manually over messages when Colyseus state synchronization already handles them.

---

# 40. Network Protocol Organization

Create explicit names/types.

Example:

```text
Input:
PlayerInput

Commands:
BuildRequest
EditBuildRequest
SelectWeaponRequest

Events:
ShotEvent
HitEvent
BuildRejectedEvent
RoundStartedEvent
RoundEndedEvent
MatchEndedEvent
```

Network strings should not be scattered:

Bad:

```ts
room.send("build-wall-now", ...)
```

Preferred:

```ts
NetworkMessage.BuildRequest
```

or typed message definitions.

---

# 41. Reconnection

Reconnection is important because this is a browser game.

Players may:

- Refresh accidentally
- Lose Wi-Fi temporarily
- Change browser focus
- Experience short connection drops

Initial rule:

```text
Disconnect
    ↓
Keep player's match slot for a short grace period
    ↓
Player reconnects
    ↓
Restore control of existing player entity
```

If grace period expires:

```text
Forfeit / remove player according to game mode rules
```

Exact timing can be balanced later.

---

# 42. Browser Tab / Focus Handling

The game must handle:

```text
tab hidden
tab visible
pointer lock lost
window focus lost
```

The client should not create giant accumulated movement deltas when returning to the tab.

Authoritative simulation continues on the server.

---

# 43. Persistence Boundaries

No database calls inside the real-time simulation tick.

Bad:

```text
Every 33 ms:
UPDATE users SET x = ...
```

Never do this.

Live state remains in memory inside the Colyseus room.

Database writes happen for meaningful persistent events:

```text
Account creation
Profile update
Match completion
Rating update
Statistics update
```

---

# 44. Match Result Transaction

When ranked mode exists:

```text
Match ends
   ↓
Server calculates result
   ↓
Calculate MMR changes
   ↓
Begin DB transaction
   ├── Insert match
   ├── Insert player results
   ├── Update ratings
   └── Update statistics
   ↓
Commit
```

Rating and result updates should be atomic.

---

# 45. Ranking Architecture

Ranking should live in pure shared/server logic.

Possible initial algorithm:

```text
Elo
```

Later:

```text
Glicko / custom MMR
```

Keep:

```text
visible rank
```

separate from:

```text
internal numeric rating
```

Example:

```text
Rating 1421 → Gold II
```

This allows us to change rank boundaries without rewriting matchmaking.

---

# 46. Authentication

Authentication is intentionally deferred.

Do not block early gameplay development on:

- Email verification
- OAuth
- Password recovery
- Profile customization

Early development can use temporary player identities.

Example:

```text
dev-player-a
dev-player-b
```

Real authentication is added after the first complete multiplayer game mode works.

---

# 47. Logging

The server should use structured logs.

Important events:

```text
room_created
player_joined
player_left
player_reconnected
match_started
round_started
round_ended
match_ended
build_rejected
invalid_input
server_error
```

Avoid noisy logs every simulation tick.

Development builds may have additional debug logging.

---

# 48. Debug Tools

We should intentionally build debug tools because real-time multiplayer debugging is difficult.

Useful debug overlays:

```text
FPS
Ping
Server tick
Interpolation delay
Player position
Predicted position
Authoritative position
Correction magnitude
Energy
Current grid cell
Build slot ID
Room ID
```

Possible toggles:

```text
F1 → networking debug
F2 → collision debug
F3 → build-grid debug
```

These tools can later be disabled in production.

---

# 49. Testing Strategy

Testing should be built into the architecture, not added at the end.

---

## 49.1 Unit Tests

Vitest should test pure game logic.

Examples:

### Energy

```text
energy never exceeds maximum
wall cost is deducted once
insufficient energy rejects build
regen produces expected value
```

### Building

```text
grid snap works correctly
duplicate slots are rejected
out-of-range build is rejected
invalid rotations are rejected
```

### Weapons

```text
fire cooldown works
ammo cannot go negative
reload rules work
damage calculations are correct
```

### Matches

```text
round winner increments score
match ends at required score
round reset removes builds
```

### Ranking

```text
winner gains rating
loser loses rating
ratings stay within expected bounds
```

---

## 49.2 Server Integration Tests

Start a real room in a test environment.

Test:

```text
two players join
match starts
player input changes authoritative state
build request creates build
invalid build request is rejected
elimination ends round
reconnection restores player
```

---

## 49.3 Browser Tests

Use Playwright for important end-to-end flows.

Example:

```text
Browser A opens game
Browser B opens game
Both join same room
Both load arena
A moves
B receives updated movement
A places wall
B sees wall
```

Do not attempt to test every graphical frame with E2E tests.

Use E2E for critical user journeys.

---

# 50. CI Pipeline

Initial GitHub Actions pipeline:

```text
Install dependencies
      ↓
Typecheck
      ↓
Lint
      ↓
Unit tests
      ↓
Server integration tests
      ↓
Build web
      ↓
Build server
```

Later:

```text
Playwright multiplayer smoke test
```

No code should be merged if:

- TypeScript fails
- Unit tests fail
- Production build fails

---

# 51. Performance Budget Philosophy

Browser games have tighter performance limits than native games.

We must monitor:

- Draw calls
- Mesh count
- Build entity count
- Physics colliders
- Network bytes/sec
- State patch size
- JavaScript main-thread time
- Garbage collection
- Server CPU per room

Do not prematurely optimize everything.

Measure first.

---

# 52. Build Rendering Optimization

A Box Fight can create many structures.

Do not create overly expensive meshes/materials per wall.

Possible optimization path:

1. Normal meshes for initial implementation
2. Shared materials
3. Mesh pooling
4. Thin instances / instancing where appropriate
5. Chunk/group static structures if needed

Do not start with complex optimization before gameplay works.

---

# 53. Object Pooling

Potential candidates later:

- Bullet tracers
- Impact effects
- Damage numbers
- Build destruction particles
- Muzzle flashes

These are visual objects and can be pooled client-side.

Authoritative entities should not be hidden behind unclear pooling abstractions too early.

---

# 54. Asset Strategy

Use simple assets initially.

Recommended:

```text
Player → capsule / simple placeholder model
Builds → clean primitive geometry
Weapons → simple placeholders
Arena → blockout geometry
```

Gameplay first.

Art replacement later.

Use GLB/GLTF for production 3D assets.

---

# 55. Input System

Create one dedicated input manager.

It handles:

```text
WASD
Jump
Crouch
Sprint
Mouse look
Fire
ADS
Weapon slots
Build mode
Wall
Floor
Ramp
Edit
```

Input mapping should not be hard-coded across random gameplay files.

This allows keybind settings later.

---

# 56. Camera Architecture

Camera state is primarily client-side.

The server does not need to synchronize the actual Babylon camera.

The server only needs relevant aiming information such as:

```text
yaw
pitch
```

within validated limits.

---

# 57. Client Game Lifecycle

Conceptual flow:

```text
React app loads
      ↓
User enters lobby
      ↓
Join Colyseus room
      ↓
Initialize Babylon game runtime
      ↓
Load arena/assets
      ↓
Bind room state
      ↓
Start prediction/render loops
      ↓
Match ends
      ↓
Dispose Babylon scene/runtime
      ↓
Return to results screen
```

Scene disposal must be explicit.

Avoid creating multiple render loops after leaving/rejoining matches.

---

# 58. Server Room Lifecycle

Conceptual flow:

```text
Room created
     ↓
Players join
     ↓
WAITING
     ↓
Enough players
     ↓
COUNTDOWN
     ↓
ROUND_ACTIVE
     ↓
...
     ↓
MATCH_END
     ↓
Persist result
     ↓
Players leave
     ↓
Room disposed
```

---

# 59. Error Handling

Network actions must fail safely.

Example build rejection:

```ts
{
  reason: "INSUFFICIENT_ENERGY",
  requestId: ...
}
```

Possible reasons:

```text
INSUFFICIENT_ENERGY
SLOT_OCCUPIED
OUT_OF_RANGE
INVALID_BUILD_TYPE
INVALID_MATCH_STATE
RATE_LIMITED
```

Avoid vague errors like:

```text
"build failed"
```

during development.

---

# 60. Security Baseline

Because this is a competitive browser game, assume users can inspect and modify all browser JavaScript.

Therefore:

> **Nothing in the browser is secret or trusted.**

Server validation must protect:

- Movement speed
- Jump rules
- Shooting cadence
- Ammo
- Health
- Energy
- Build range
- Build costs
- Build rate
- Match scoring
- Ranking

Obfuscating JavaScript is not an anti-cheat strategy.

---

# 61. Rate Limiting

Server should eventually limit abusive message rates.

Examples:

```text
build requests / second
weapon select requests / second
chat messages / second
room actions / second
```

Continuous player input should use the intended Colyseus input path rather than generic high-frequency messages.

---

# 62. No Premature Microservices

Initial backend:

```text
ONE game server application
```

Not:

```text
auth-service
match-service
physics-service
ranking-service
inventory-service
event-bus
Kafka
Kubernetes
```

That would add complexity without improving the project.

We can extract services only if actual scaling requirements appear.

---

# 63. No Redis Initially

Redis is deferred.

Potential future use:

- Cross-process matchmaking
- Presence
- Distributed room discovery
- Rate limiting
- Sessions

But for the school project and early development, it is unnecessary.

---

# 64. Deployment Architecture

Later production deployment:

```text
                 INTERNET

        ┌──────────────────────┐
        │ Static Web Hosting   │
        │ React + Babylon      │
        └──────────┬───────────┘
                   │
                   │ HTTPS/WSS
                   ▼
        ┌──────────────────────┐
        │ Node Game Server     │
        │ Colyseus             │
        │ persistent process   │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ PostgreSQL           │
        └──────────────────────┘
```

Do not deploy the real-time game server as a purely short-lived serverless function.

It needs persistent WebSocket connections and room processes.

---

# 65. Environment Separation

Use:

```text
development
test
production
```

Do not share the production database with automated tests.

Configuration should come from environment variables where appropriate.

Never commit secrets.

---

# 66. Coding Standards

Default rules:

- TypeScript strict mode
- Avoid `any`
- Prefer small focused modules
- Pure functions for game rules where practical
- Explicit domain types
- No hidden global mutable state
- No gameplay constants inside UI components
- No database logic inside game simulation
- No Babylon imports inside shared simulation logic
- No React imports inside game server
- No client-authoritative damage/scoring

---

# 67. AI Coding Rules

Because the project is built heavily with AI coding tools, every AI session must follow these rules.

---

## Rule 1 — Read Architecture First

Before implementing a major feature, the AI agent should read:

```text
docs/GAME_DESIGN.md
docs/TECHNICAL_ARCHITECTURE.md
```

and relevant existing code.

---

## Rule 2 — Do Not Change Architecture Silently

If an AI agent believes a different architecture is better, it must:

1. Explain the conflict
2. Explain the proposed change
3. Explain tradeoffs
4. Update an ADR if the change is accepted

It should not silently replace Colyseus, Rapier, Babylon, package boundaries, or authority rules.

---

## Rule 3 — One Stage at a Time

AI tasks should have a clearly defined scope.

Bad:

```text
Build the entire multiplayer game.
```

Better:

```text
Implement server-authoritative wall placement with:
- grid snapping
- energy validation
- occupancy validation
- unit tests

Do not implement editing, destruction, or UI.
```

---

## Rule 4 — Tests Are Part of Features

When practical, a feature implementation should include tests.

Example:

```text
Feature:
Energy-based wall placement

Implementation:
✓ validator
✓ authoritative energy deduction
✓ build creation
✓ state sync

Tests:
✓ valid placement
✓ insufficient energy
✓ occupied slot
✓ out of range
```

---

## Rule 5 — No Fake Completion

The AI must clearly distinguish:

```text
Implemented
Tested
Build verified
Not verified
Blocked
```

Never claim a multiplayer behavior works merely because TypeScript compiles.

---

# 68. Architecture Decision Records

Major architecture changes should be recorded in:

```text
docs/adr/
```

Example:

```text
0001-use-babylon.md
0002-use-colyseus.md
0003-server-authoritative-netcode.md
0004-use-rapier.md
0005-build-grid-model.md
```

ADR format:

```text
# Decision

## Context

## Options Considered

## Decision

## Consequences
```

This is especially useful for demonstrating third-year software-engineering decisions during the project presentation.

---

# 69. Development Order

Do not build systems in random order.

Recommended architecture-driven order:

```text
1. Monorepo/tooling
2. Babylon scene
3. Local character movement
4. Colyseus room
5. Multiplayer movement
6. Prediction/reconciliation
7. Combat
8. Building grid
9. Authoritative building
10. Energy
11. Build destruction
12. Box Fight rules
13. Polish networking
14. King of the Tower
15. Persistence
16. Ranking
17. Deployment/polish
```

---

# 70. First Technical Milestone

The first serious multiplayer milestone should be:

> **Two browser clients join the same room and control predicted third-person characters whose authoritative movement is simulated by the server.**

Success criteria:

```text
✓ Two tabs can join
✓ Both players appear
✓ Local movement feels immediate
✓ Server owns authoritative state
✓ Remote player moves smoothly
✓ Jump works
✓ Collision works
✓ Artificial latency can be tested
✓ Reconciliation corrections are observable in debug mode
```

Do not add shooting or building until this foundation is stable.

---

# 71. Second Technical Milestone

> **Two players can fight using one server-authoritative hitscan weapon.**

Success criteria:

```text
✓ Weapon equipped
✓ Fire input reaches server
✓ Fire cooldown validated
✓ Server performs hit test
✓ Damage is authoritative
✓ Health synchronizes
✓ Elimination works
✓ Respawn/reset works
```

---

# 72. Third Technical Milestone

> **Server-authoritative energy building works during multiplayer.**

Success criteria:

```text
✓ Wall preview
✓ Grid snapping
✓ Build request
✓ Server validation
✓ Energy cost
✓ Shared build state
✓ Build collider
✓ Build health
✓ Build destruction
```

At this point the unique core of the project exists.

---

# 73. Fourth Technical Milestone

> **A complete 1v1 Energy Box Fight match can be played from start to finish.**

Success criteria:

```text
✓ Join
✓ Countdown
✓ Fight
✓ Build
✓ Eliminate
✓ Round winner
✓ Reset
✓ Best-of-5
✓ Match winner
✓ Return to results
```

This is the MVP.

Everything after this is expansion.

---

# 74. Decisions Explicitly Deferred

Do not solve these yet:

- Exact production hosting provider
- Authentication provider
- Cosmetics
- Inventory/progression
- 2v2/3v3
- Build editing
- Replays
- Spectator mode
- Tournaments
- Redis
- Horizontal scaling
- WebGPU-specific optimization
- Mobile support
- Controller support
- Advanced lag compensation
- Seasonal ranking

These may be reconsidered after the Box Fight MVP exists.

---

# 75. Non-Goals for the MVP

The MVP is **not**:

- A Battle Royale
- A Fortnite clone
- An MMO
- A 20-player game
- A fully destructible open world
- A game with dozens of weapons
- A persistent inventory game
- A microservice architecture
- A photorealistic game

The MVP is:

> A polished 1v1 competitive building shooter with server-authoritative movement, combat, energy-based building, rounds, and a winner.

---

# 76. Current Architecture Summary

```text
LANGUAGE
└── TypeScript

MONOREPO
├── apps/web
├── apps/game-server
├── packages/protocol
├── packages/simulation
├── packages/game-config
└── packages/database (later)

CLIENT
├── React
├── Babylon.js
├── Vite
├── Rapier
├── Colyseus SDK
├── Prediction
├── Reconciliation
└── Interpolation

SERVER
├── Node.js
├── Colyseus 0.18+
├── Fixed authoritative timestep
├── Rapier
├── Combat validation
├── Build validation
├── Match state
└── Reconnection

INITIAL NETCODE
├── 30 Hz authoritative input/simulation
├── 2 physics substeps when required
├── ~60 Hz effective physics
├── ~20 Hz state patches initially
├── Local prediction
├── Server reconciliation
└── Remote interpolation

GAMEPLAY AUTHORITY
└── SERVER

PERSISTENCE — LATER
├── PostgreSQL
└── Drizzle

TESTING
├── Vitest
└── Playwright

DEPLOYMENT — LATER
├── Static client
├── Persistent Node/Colyseus server
└── PostgreSQL
```

---

# 77. Architecture Principle to Keep

When deciding where new code belongs, use this rule:

```text
Does it decide GAME TRUTH?
        │
       YES
        ▼
      SERVER
```

```text
Does it make GAME TRUTH look/feel responsive?
        │
       YES
        ▼
      CLIENT
```

```text
Does the exact same deterministic rule need to run in both places?
        │
       YES
        ▼
 packages/simulation
```

```text
Is it a network contract?
        │
       YES
        ▼
 packages/protocol
```

```text
Is it a tunable gameplay value?
        │
       YES
        ▼
 packages/game-config
```

This rule should prevent most architecture mistakes during development.

---

# 78. Final Locked Technical Vision

The game will be a browser-native TypeScript application.

Babylon.js renders the 3D game.

React handles the surrounding web interface and HUD.

Colyseus runs the authoritative multiplayer server and provides the fixed-timestep/prediction/reconciliation foundation.

Rapier provides physics and collision support for the character, arena, and builds.

The client sends player intent.

The server determines authoritative movement, damage, building, energy, scoring, and victory.

Shared deterministic simulation code is isolated from rendering and server infrastructure.

The database is only used for persistent state and does not participate in the real-time tick loop.

The first milestone is not a complete game.

The first milestone is a **correct multiplayer movement architecture**.

Once that foundation works, combat and building can be added without needing to rewrite the networking model.
