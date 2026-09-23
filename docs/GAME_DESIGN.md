# Project Concept — Competitive Browser Building Shooter

## Working Title
**Project Towerfall**  
*Working title only — can be renamed later.*

---

# 1. Project Vision

The goal of this project is to build a polished **competitive multiplayer browser game** focused on fast third-person combat, tactical building, and short competitive matches.

The game takes inspiration from the building and close-range combat mechanics found in games such as Fortnite, but it is **not intended to be a Fortnite clone**.

The project will create its own identity around two core game modes:

1. **Energy Box Fights**
2. **King of the Tower Build Battles**

Both modes use the same core movement, shooting, building, destruction, and networking systems, but each mode has a different competitive objective.

The game should feel:

- Fast
- Competitive
- Skill-based
- Easy to understand
- Hard to master
- Replayable
- Technically impressive
- Suitable for short browser-based matches

The game will be developed over approximately **12 lessons**, with AI coding tools being used throughout the development process for implementation, debugging, architecture, testing, refactoring, and documentation.

The game itself does **not** need to contain artificial intelligence.

---

# 2. Core Design Pillars

## 2.1 Competitive First

Every game mode must have a clear winner and loser.

The player should always understand:

- What the objective is
- How they are currently performing
- What they need to do to win
- Why they lost a round or match

The game should reward mechanical skill, positioning, resource management, building skill, aim, and decision making.

---

## 2.2 Building Is a Resource

Unlike Fortnite, players cannot endlessly spam structures.

Building uses a regenerating resource called **Energy**.

This creates an additional layer of strategy.

A player must decide:

- Should I spend energy defending myself?
- Should I save energy for an aggressive push?
- Should I build upward to gain height?
- Should I reinforce my current position?
- Should I destroy the opponent's structures instead of building my own?

This makes building an important strategic resource rather than only a mechanical action.

---

## 2.3 Short, Replayable Matches

Matches should be relatively short.

Target match length:

**5–10 minutes**

Short matches allow players to quickly:

- Requeue
- Try different strategies
- Improve mechanically
- Climb the ranking system
- Play multiple matches in one session

---

## 2.4 Skill Expression

The game should allow skilled players to separate themselves through:

- Aim
- Movement
- Building speed
- Build placement
- Energy management
- Editing
- Positioning
- Timing
- Game awareness
- Objective control

The game should be simple enough to understand but have enough depth for players to continuously improve.

---

# 3. Core Gameplay Systems

Both game modes share the same core systems.

---

## 3.1 Player Movement

The player controls a third-person character.

Initial movement mechanics:

- Walk
- Run
- Jump
- Fall
- Crouch

Possible later additions:

- Sprint
- Slide
- Mantle
- Vault
- Air control
- Fall damage
- Jump fatigue

Movement should feel responsive because the game is highly competitive.

---

# 3.2 Third-Person Camera

The game uses a third-person camera.

The camera should:

- Follow behind the player
- Allow free mouse movement
- Support aiming
- Avoid clipping through walls
- React smoothly to player movement

Possible later features:

- Shoulder switching
- Different FOV while aiming
- Camera shake
- Hit reactions

---

# 3.3 Combat

The initial combat system should remain relatively focused.

Possible starting weapon set:

### Shotgun
- High close-range damage
- Low fire rate
- Rewards accurate shots

### Assault Rifle
- Medium damage
- Higher fire rate
- Effective at medium range

Additional weapons can be added later.

Possible future weapons:

- SMG
- Burst rifle
- Sniper
- Pistol
- Explosive weapon

The initial project should prioritize **good gunplay over many weapons**.

---

# 3.4 Health and Shield

Players have:

- Health
- Optional shield

Example:

```text
Health: 100
Shield: 50
```

Damage is applied to shield first.

When health reaches zero, the player is eliminated.

---

# 3.5 Building System

Building is one of the most important systems in the project.

Initial structure types:

- Wall
- Floor
- Ramp
- Roof / Cone

Structures should snap to a grid.

Before placing a structure, the client displays a **ghost preview**.

Example:

```text
GREEN = valid placement
RED   = invalid placement
```

When the player confirms placement, the server validates the request.

---

## 3.5.1 Server Build Validation

The client should never have full authority over building.

Example flow:

```text
Player selects Wall
        ↓
Client calculates placement preview
        ↓
Player presses build button
        ↓
Client sends placement request
        ↓
Server validates request
        ↓
Server creates structure
        ↓
Server broadcasts structure
        ↓
All players see the build
```

The server checks:

- Does the player have enough energy?
- Is the structure within placement range?
- Is the grid location valid?
- Is another structure already occupying the location?
- Is the player allowed to build in this area?
- Is the requested build type valid?
- Is the player placing structures too quickly?

---

# 3.6 Building Energy

Building structures consumes **Energy**.

Energy regenerates automatically over time.

Example starting values:

```text
Maximum Energy: 100

Wall: 20 Energy
Floor: 15 Energy
Ramp: 20 Energy
Cone: 20 Energy

Energy Regeneration:
10 Energy / second
```

These values are placeholders and will require balancing.

The player always sees their current energy level in the HUD.

Example:

```text
ENERGY
████████░░
80 / 100
```

Energy regeneration prevents players from permanently running out while also preventing unlimited build spam.

---

# 3.7 Build Construction

Structures do not necessarily need to appear instantly at full strength.

Possible construction system:

```text
0 ms      → 50 HP
500 ms    → 100 HP
1000 ms   → 200 HP
1500 ms   → 300 HP
2000 ms   → Full HP
```

This allows opponents to attack structures while they are still being constructed.

It also makes building timing important.

---

# 3.8 Build Destruction

Every structure has health.

Example:

```text
Wall HP: 400
Ramp HP: 350
Floor HP: 350
Cone HP: 350
```

Weapons damage structures.

When structure health reaches zero:

```text
Structure destroyed
        ↓
Server removes structure
        ↓
Removal is broadcast
        ↓
All clients remove structure
```

---

# 3.9 Build Ownership

Every structure stores ownership information.

Example:

```text
Build
├── ID
├── Type
├── Position
├── Rotation
├── Owner Player
├── Owner Team
├── Health
├── Current Build Progress
└── Created At
```

Ownership becomes important for:

- Editing
- Replacement
- Team building
- Statistics
- Validation

---

# 3.10 Build Editing

Editing is an advanced feature and should be implemented after the core building system is stable.

A possible system uses a grid.

Example wall:

```text
[X][X][X]
[X][X][X]
[X][X][X]
```

Editing could create shapes such as:

### Door

```text
[X][ ][X]
[X][ ][X]
[X][X][X]
```

### Window

```text
[X][X][X]
[X][ ][X]
[X][X][X]
```

### Half Wall

```text
[ ][ ][ ]
[X][X][X]
[X][X][X]
```

The exact editing system can differ from Fortnite to create a unique identity.

---

# 4. Game Mode 1 — Energy Box Fights

## 4.1 Overview

Energy Box Fights is a fast competitive elimination mode.

Possible formats:

- 1v1
- 2v2
- 3v3

The first version should focus on **1v1**.

Players fight inside a relatively small arena.

Every player starts with:

- The same weapons
- Full health
- Full energy
- Equal starting conditions

There is no loot randomness.

The winner should primarily be determined by skill.

---

# 4.2 Match Structure

A match uses multiple rounds.

Example:

```text
Best of 5

First player to win 3 rounds wins the match.
```

Flow:

```text
Round Start
    ↓
Players Spawn
    ↓
3 Second Countdown
    ↓
Combat Begins
    ↓
Player Eliminated
    ↓
Round Winner
    ↓
Score Updated
    ↓
Next Round
```

Example scoreboard:

```text
PLAYER A        PLAYER B

   2       -       1
```

---

# 4.3 Box Fight Arena

The arena should be compact enough that players quickly engage each other.

Possible design:

```text
+-----------------------+
|                       |
|      BUILD AREA       |
|                       |
|                       |
|       CENTER          |
|                       |
|                       |
|      BUILD AREA       |
|                       |
+-----------------------+
```

Players may immediately begin building defensive or offensive structures.

---

# 4.4 Energy Strategy

Energy is especially important in this mode.

Example situation:

```text
Player A:
20 Energy

Player B:
80 Energy
```

Player A may have better positioning but cannot build many defensive structures.

Player B can apply pressure because they still have energy available.

This creates tactical decisions beyond aim.

---

# 4.5 Anti-Camping Mechanic

To keep rounds short, the arena can become more dangerous over time.

Possible system:

```text
0:00 → Full Arena
0:45 → Outer Area Disabled
1:15 → Arena Shrinks
1:45 → Final Combat Area
```

Alternatively, environmental damage can slowly increase.

This prevents players from hiding indefinitely.

---

# 4.6 Victory

A round ends when:

- One player is eliminated
- One entire team is eliminated
- Optional round timer expires

A match ends when one player or team reaches the required number of round wins.

---

# 5. Game Mode 2 — King of the Tower

## 5.1 Overview

King of the Tower is the more unique game mode.

Two players start near ground level.

High above the arena is a floating **Crystal**.

Players must:

- Build upward
- Fight for height
- Destroy enemy structures
- Protect their own structures
- Reach the crystal
- Hold control of the objective

The player who successfully controls the crystal earns points.

---

# 5.2 Core Objective

The objective is not simply to eliminate the opponent.

Eliminations create opportunities, but the **Crystal determines the winner**.

Example:

```text
Reach Crystal
      ↓
Stay Inside Capture Area
      ↓
Hold For 10 Seconds
      ↓
Earn 1 Point
```

Possible match rule:

```text
First to 3 points wins.
```

---

# 5.3 Crystal Capture

When a player enters the crystal capture zone:

```text
CAPTURING

██████░░░░

6.2 / 10 seconds
```

If the enemy also enters the area:

```text
CONTESTED
```

Capture progress stops until only one player remains in the zone.

---

# 5.4 Eliminations

Eliminating the opponent does not immediately win the match.

Instead, the eliminated player respawns after a short delay.

Example:

```text
Respawn in:

3
2
1
```

The surviving player gets temporary control of the arena and can attempt to capture the crystal.

This creates an important relationship:

```text
Combat → creates advantage
Objective → wins the game
```

---

# 5.5 Vertical Arena

The arena should be designed around vertical movement.

Example:

```text
               [ CRYSTAL ]
                   ▲
                   │
             Build toward
                   │
          ┌──────────────┐
          │              │
          │    AIR       │
          │              │
          └──────────────┘

 Player A Spawn       Player B Spawn
        \                 /
         \               /
          ─── Ground ───
```

Players create their own paths upward using:

- Floors
- Ramps
- Walls
- Cones

There may also be a small number of permanent platforms.

---

# 5.6 Falling

Falling creates an important risk.

Possible rules:

### Option A
Player falls to ground and continues.

### Option B
Player takes fall damage.

### Option C
Falling into the void causes elimination.

The best option should be determined during testing.

---

# 5.7 Energy in King of the Tower

Energy becomes an important strategic system.

Players cannot simply build directly upward forever.

They need to balance:

```text
Building upward
vs
Defending
vs
Attacking
vs
Saving energy
```

For example:

A player may reach the crystal quickly but use almost all their energy.

The opponent may arrive later with enough energy to build protection and take control.

---

# 5.8 Crystal Reset

After one player successfully captures the objective:

```text
Point Awarded
      ↓
Arena Reset
      ↓
Players Respawn
      ↓
Builds Removed
      ↓
3 Second Countdown
      ↓
Next Round
```

This prevents the arena from becoming permanently filled with structures.

---

# 6. Competitive Ranking System

The ranking system is a later-stage feature.

Players receive a competitive rating.

Each game mode may use its own rating.

Example:

```text
Box Fight Rating:
1427

King of the Tower Rating:
1365
```

---

# 6.1 Possible Ranks

Example divisions:

```text
Bronze
Silver
Gold
Platinum
Diamond
Master
Champion
```

Each rank may contain divisions.

Example:

```text
Gold III
Gold II
Gold I
```

---

# 6.2 Rating Changes

After a match:

```text
WIN
+24 Rating

LOSS
-18 Rating
```

The exact rating algorithm could use:

- Elo
- Glicko
- Custom MMR

A simple Elo-style system would be sufficient initially.

---

# 6.3 Ranking Data

The system may track:

```text
Player
├── Current Rating
├── Highest Rating
├── Current Rank
├── Highest Rank
├── Wins
├── Losses
├── Win Rate
├── Kills
├── Deaths
├── K/D
├── Win Streak
├── Matches Played
└── Mode-Specific Stats
```

---

# 6.4 Leaderboard

Possible leaderboards:

```text
Top Box Fight Players
Top King of the Tower Players
Most Wins
Highest Win Streak
Highest K/D
```

Example:

```text
RANK   PLAYER        RATING

#1     PlayerOne      1943
#2     Nova           1901
#3     Raze           1878
#4     Echo           1845
```

---

# 7. Matchmaking

The initial project does not need complicated matchmaking.

Early version:

```text
Create Room
Join Room
Private Room Code
```

Example:

```text
ROOM CODE

X7F2K
```

Later version:

```text
Quick Play
     ↓
Matchmaking Queue
     ↓
Find Player
     ↓
Create Match
     ↓
Start Game
```

Ranked matchmaking can later attempt to match players with similar rating.

---

# 8. Multiplayer Architecture

The game should use a **server-authoritative architecture**.

The server is responsible for important game logic.

The client mainly sends player input and renders the result.

---

# 8.1 High-Level Architecture

```text
┌────────────────────────────┐
│        WEB BROWSER         │
│                            │
│ React / UI                 │
│ 3D Game Engine             │
│ Input                      │
│ Rendering                  │
│ Prediction                 │
└─────────────┬──────────────┘
              │
              │ WebSocket
              │
              ▼
┌────────────────────────────┐
│        GAME SERVER         │
│                            │
│ Match Manager              │
│ Player State               │
│ Combat Validation          │
│ Build Validation           │
│ Energy                     │
│ Game Modes                 │
│ Round Logic                │
│ Ranking                    │
└─────────────┬──────────────┘
              │
              ▼
┌────────────────────────────┐
│          DATABASE          │
│                            │
│ Accounts                   │
│ Rankings                   │
│ Match History              │
│ Statistics                 │
└────────────────────────────┘
```

---

# 8.2 Possible Technology Stack

Possible frontend:

```text
TypeScript
React
Babylon.js
```

Alternative:

```text
TypeScript
React
Three.js
```

Babylon.js may be a strong option because it already provides many features useful for browser games.

---

## Server

Possible backend:

```text
Node.js
TypeScript
WebSocket / Socket.IO
```

---

## Database

```text
PostgreSQL
```

Possible ORM:

```text
Prisma
```

---

# 9. Networking Systems

Because the game is competitive, networking quality is important.

Possible systems to explore:

- Server tick rate
- Input synchronization
- Player interpolation
- Client-side prediction
- Server reconciliation
- Latency handling
- Snapshot interpolation
- State delta updates
- Rate limiting

Not every advanced networking technique must be implemented immediately.

The project should begin with reliable synchronization and improve over time.

---

# 10. Server-Authoritative Combat

The client should not be allowed to directly decide damage.

Bad architecture:

```text
Client:
"I hit Player B for 80 damage."
```

Better architecture:

```text
Client:
"I fired my shotgun."

Server:
↓
Validate weapon
↓
Validate ammo
↓
Validate fire rate
↓
Validate player state
↓
Perform hit detection
↓
Calculate damage
↓
Apply damage
↓
Broadcast result
```

This prevents easy cheating and creates a more professional multiplayer architecture.

---

# 11. Anti-Cheat Considerations

The game does not need a complete anti-cheat system.

However, important actions should be validated by the server.

Possible checks:

### Movement
- Maximum speed
- Maximum jump height
- Teleport detection

### Shooting
- Fire rate
- Ammo
- Reload state
- Weapon ownership

### Building
- Energy cost
- Placement range
- Build rate
- Valid grid
- Collision

### Match
- Correct team
- Correct player state
- Valid game mode action

---

# 12. User Interface

The HUD may contain:

```text
┌──────────────────────────────────┐

Health        ██████████ 100
Shield        █████░░░░░ 50

Energy        ███████░░░ 70

Weapon        Shotgun
Ammo          5 / 25

                 CROSSHAIR

Score
Player A  2 - 1  Player B

Timer          01:42

└──────────────────────────────────┘
```

For King of the Tower:

```text
CRYSTAL STATUS

CAPTURING
████████░░
8.3 / 10
```

---

# 13. Match History

Players may be able to view previous matches.

Example:

```text
MATCH HISTORY

WIN
Box Fight
3 - 1
+24 Rating

LOSS
King of the Tower
1 - 3
-17 Rating

WIN
Box Fight
3 - 2
+21 Rating
```

---

# 14. Player Profile

Possible player profile:

```text
PLAYER: Nova

Rank:
Diamond II

Box Fight Rating:
1674

King of the Tower Rating:
1581

Matches Played:
184

Wins:
112

Win Rate:
60.8%

K/D:
1.84
```

---

# 15. Lobby System

Before a match, players enter a lobby.

Possible lobby:

```text
PLAYER A
READY

VS

PLAYER B
READY
```

Possible controls:

- Choose game mode
- Ready
- Leave lobby
- Invite player
- Select loadout
- Select cosmetic later

---

# 16. Cosmetics — Optional Future System

Cosmetics are not necessary for the school project but could be added later.

Possible cosmetic categories:

- Character skins
- Weapon skins
- Build materials
- Pickaxe / tool
- Emotes
- Player banners
- Rank icons

These should have no gameplay advantage.

---

# 17. Art Direction

The game should avoid trying to achieve photorealism.

A stylized low-poly visual style is more realistic for the available development time.

Possible visual direction:

- Bright stylized arenas
- Simple geometry
- Strong silhouettes
- Clean UI
- Clear team colors
- Strong build placement feedback
- Simple but satisfying particle effects

The visual goal should be:

**Polished rather than realistic.**

---

# 18. Audio

Important sounds:

- Gunshots
- Hit confirmation
- Build placement
- Build destruction
- Energy empty
- Crystal capture
- Round win
- Match victory
- Footsteps
- Jump / landing

Audio feedback is important for making the game feel responsive.

---

# 19. Minimum Viable Product

The project should always maintain a realistic MVP.

The first completely playable version only needs:

```text
1v1 Energy Box Fight

✓ Multiplayer room
✓ Two players
✓ Movement
✓ Third-person camera
✓ Shooting
✓ Health
✓ Elimination
✓ Wall
✓ Floor
✓ Ramp
✓ Energy
✓ Build placement
✓ Build destruction
✓ Round reset
✓ Best-of-5 scoring
✓ Match winner
```

If this version works well, the project is already successful.

---

# 20. Extended Version

After the MVP:

```text
✓ Cone
✓ Build editing
✓ Better weapons
✓ Spectating
✓ King of the Tower
✓ Matchmaking
✓ Accounts
✓ Statistics
✓ Match history
✓ Ranked mode
✓ Leaderboards
✓ Improved networking
✓ Advanced movement
✓ Better effects
```

---

# 21. Stretch Goals

Only implement these if the main game is already polished.

Possible stretch goals:

- 2v2 Box Fights
- 3v3 Box Fights
- Replay system
- Spectator mode
- Tournament brackets
- Custom private matches
- Player-created arenas
- Seasonal ranking
- Cosmetic progression
- Ranked placement matches
- Controller support
- Mobile browser support

---

# 22. Suggested 12-Lesson Development Roadmap

This roadmap is flexible and can change depending on progress.

---

## Lesson 1 — Project Foundation

Goal:

Create the technical foundation.

Tasks:

- Repository setup
- TypeScript configuration
- Frontend setup
- 3D engine setup
- Basic test map
- Character rendering
- Development workflow

Result:

A player can load into a 3D browser environment.

---

## Lesson 2 — Character Controller

Tasks:

- Movement
- Jumping
- Camera
- Collision
- Basic animation
- Responsive controls

Result:

The game already feels controllable.

---

## Lesson 3 — Multiplayer Foundation

Tasks:

- Game server
- WebSocket connection
- Rooms
- Player join/leave
- Player synchronization

Result:

Two players can see each other moving.

---

## Lesson 4 — Combat

Tasks:

- Weapon system
- Shooting
- Hit detection
- Health
- Damage
- Elimination
- Respawn

Result:

Players can fight each other.

---

## Lesson 5 — Building Foundation

Tasks:

- Grid system
- Build previews
- Wall
- Floor
- Ramp
- Server validation

Result:

Players can build synchronized structures.

---

## Lesson 6 — Energy + Destruction

Tasks:

- Energy system
- Energy regeneration
- Build costs
- Build health
- Build damage
- Destruction

Result:

The main unique mechanic is functional.

---

## Lesson 7 — Box Fight Mode

Tasks:

- Box Fight arena
- Spawn system
- Round system
- Best-of-5
- Round reset
- Scoreboard

Result:

The first complete game mode is playable.

---

## Lesson 8 — Polish Box Fights

Tasks:

- Improved shooting
- Better movement
- Networking improvements
- UI
- Audio
- Visual feedback
- Balancing

Result:

Box Fights should now feel like an actual game.

---

## Lesson 9 — King of the Tower

Tasks:

- Vertical arena
- Crystal objective
- Capture zone
- Respawning
- Point scoring
- Arena reset

Result:

Second game mode becomes playable.

---

## Lesson 10 — Accounts + Persistence

Tasks:

- User accounts
- Database
- Player profiles
- Statistics
- Match history

Result:

Players now have persistent identities.

---

## Lesson 11 — Ranked System

Tasks:

- MMR
- Rank divisions
- Rating calculation
- Ranked queue
- Leaderboard

Result:

The game gains long-term competitive progression.

---

## Lesson 12 — Final Polish + Deployment

Tasks:

- Bug fixing
- Security checks
- Performance optimization
- UI polish
- Final balancing
- Automated testing
- Deployment
- Documentation
- Presentation preparation

Result:

A complete playable multiplayer browser game.

---

# 23. AI-Assisted Development

The course focuses on coding with AI.

AI can be used throughout the project for:

- Architecture discussions
- Code generation
- Debugging
- Refactoring
- Unit tests
- Integration tests
- Networking analysis
- Database schema design
- Code review
- Documentation
- Performance analysis
- Security review
- CI/CD configuration

The developer remains responsible for:

- Understanding generated code
- Testing generated code
- Reviewing architecture
- Making design decisions
- Verifying correctness
- Maintaining code quality

---

# 24. AI Development Log

It may be useful to maintain:

```text
AI_WORKLOG.md
```

Possible entries:

```text
## Lesson 5

Task:
Implement server-authoritative build placement.

AI Tool:
Codex / ChatGPT / Claude

AI Contribution:
Suggested grid architecture and generated initial validator.

Developer Changes:
Reworked collision checks and changed build ownership model.

Testing:
Added 12 unit tests covering invalid placement cases.

Result:
Server correctly rejects overlapping structures.
```

This would demonstrate how AI was used as a development tool rather than simply generating the entire project blindly.

---

# 25. Why This Project Is Technically Interesting

Although the game concept is easy to understand, the implementation contains several advanced software engineering challenges.

These include:

- Real-time multiplayer
- Network synchronization
- Authoritative server architecture
- 3D browser rendering
- Character movement
- Shooting
- Hit detection
- Build placement
- Grid systems
- Build destruction
- Resource management
- Round management
- Objective-based gameplay
- Matchmaking
- Persistent accounts
- Database design
- Ranking algorithms
- Client/server security
- Network latency
- Performance optimization
- Automated testing
- CI/CD
- Deployment

This makes the project appropriate for a third-year AI & Software student.

---

# 26. Final Project Identity

The project should ultimately be described as:

> A competitive third-person multiplayer browser game where players combine shooting, movement, and energy-based building in short skill-based matches.

The two main modes are:

### Energy Box Fights
Players fight in a compact arena using weapons and a regenerating building-energy system. The first player or team to win the required number of elimination rounds wins the match.

### King of the Tower
Players build upward through a vertical arena while fighting for control of a crystal. Eliminations create temporary advantages, but the match is won by successfully controlling the objective.

The long-term competitive layer includes:

- Matchmaking
- Player profiles
- Statistics
- Ranked ratings
- Rank divisions
- Match history
- Leaderboards

---

# 27. Primary Development Priority

The project should follow this priority order:

```text
1. Movement feels good
2. Multiplayer is reliable
3. Shooting feels good
4. Building works correctly
5. Energy creates meaningful decisions
6. Box Fights are fun
7. King of the Tower works
8. Networking is improved
9. Ranking and persistence
10. Visual polish
```

A polished small game is more valuable than a huge unfinished game.

---

# 28. Current Locked Concept

The current project vision is:

```text
Competitive Multiplayer Browser Building Shooter

CORE MECHANICS
├── Third-person movement
├── Shooting
├── Building
├── Editing
├── Build destruction
└── Regenerating build energy

GAME MODE 1
Energy Box Fights
├── 1v1 initially
├── Elimination rounds
├── Best-of-5
├── Energy-based building
└── Small competitive arena

GAME MODE 2
King of the Tower
├── 1v1 initially
├── Vertical build battle
├── Central crystal
├── Hold crystal to score
├── Eliminations create advantages
└── First to target score wins

COMPETITIVE SYSTEM
├── Player profiles
├── Match history
├── Statistics
├── MMR
├── Ranks
├── Ranked matchmaking
└── Leaderboards
```

This concept should act as the main design direction unless deliberate design changes are made later during development.

---

# 29. Development Principle

Whenever a new feature is considered, ask:

> Does this improve the core competitive loop of shooting, building, movement, energy management, or objective control?

If the answer is no, the feature is probably not necessary yet.

The priority is to make the core game **feel excellent** before expanding the scope.
