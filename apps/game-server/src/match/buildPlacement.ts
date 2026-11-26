import type { Client } from "@colyseus/core";
import type { RoomStateSchemaInstance } from "@buildshift/protocol";
import {
  validateStructurePlacementIntent,
  canAffordBuild,
  computeEnergyAfterBuild,
  ENERGY_EVENTS,
  BUILD_EVENTS,
  createDefaultEditState,
} from "@buildshift/protocol";
import {
  BUILD_RATE,
  getStructureConfig,
  isValidPlacementRotation,
  isWithinPlacementRange,
  ENERGY,
  getStructureDurability,
  structureCuboids,
  isGridAllowedDuringPreparation,
  placementEyePoint,
  placementIsVisible,
  placementIsSupported,
  placementActorsBlockCandidate,
  type GeometryEditState,
  type PlacementActorPose,
  type PreparationSide,
  type StructureGeometryInput,
} from "@buildshift/game-config";
import {
  StructureStateSchema,
  StructureGridSchema,
  ib,
  oc,
} from "../state/buildingState.js";
import type { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";
import type { BuildingStateSchemaInstance } from "../state/buildingState.js";

/**
 * Replicated schema structure → the canonical `GeometryEditState` (mirrors
 * the room's own mapping — edit holes must be real holes for the shared
 * occlusion solids, exactly as for hitscan/collision).
 */
function editStateOf(s: InstanceType<typeof StructureStateSchema>): GeometryEditState | undefined {
  if (s.editKind === "wall" && s.editTiles.length === 9) return { kind: "wall", tiles: [...s.editTiles] };
  if (s.editKind === "floor_cone" && s.editTiles.length === 4) return { kind: "floor_cone", tiles: [...s.editTiles] };
  if (s.editKind === "ramp" && ["full", "flipped", "half_left", "half_right", "turn_left", "turn_right"].includes(s.editRampVariant)) {
    return { kind: "ramp", variant: s.editRampVariant as Extract<GeometryEditState, { kind: "ramp" }>["variant"] };
  }
  return undefined;
}

/**
 * The canonical geometry of every currently placed structure — the SAME
 * edit-aware solids the occlusion gate consumes (edit holes are real holes),
 * reused by the structural-support gate so neither gate can drift from the
 * authoritative replicated state. Built only from server state; a client
 * never supplies structure geometry.
 */
function existingStructureGeometry(ctx: BuildCtx): StructureGeometryInput[] {
  const structures: StructureGeometryInput[] = [];
  for (const s of ctx.bld.structures.values()) {
    structures.push({
      buildType: s.buildType as StructureGeometryInput["buildType"],
      grid: { x: s.grid.x, y: s.grid.y, z: s.grid.z },
      rotation: s.rotation,
      editGrid: editStateOf(s),
    });
  }
  return structures;
}

/**
 * The authoritative actor poses for the occupancy gate: EVERY player in the
 * room (the placer AND the opponent), from the replicated feet pose and the
 * replicated crouch flag — never from a client claim. Eliminated players are
 * out of the fight (their capsule is no longer simulated), so they cannot
 * block a placement.
 */
function authoritativeActorPoses(ctx: BuildCtx): PlacementActorPose[] {
  const actors: PlacementActorPose[] = [];
  for (const pl of ctx.state.players.values()) {
    if (pl.isEliminated === true || pl.alive === false) continue;
    actors.push({ x: pl.x, y: pl.y, z: pl.z, crouched: pl.crouch === true });
  }
  return actors;
}

/**
 * The shared placement line-of-sight gate (see game-config
 * `placementVisibility.ts`). Built ONLY from authoritative server data: the
 * player's replicated pose + crouch (canonical shared eye: standing 1.2 /
 * crouch 0.9 via `placementEyePoint`) and the canonical, edit-aware solids
 * of every existing structure plus the arena shell. A client-sent
 * visibility claim or eye position is never consulted.
 */
function placementHasLineOfSight(ctx: BuildCtx, sid: string, it: { buildType: string; grid: { x: number; y: number; z: number }; rotation: number }, structures: readonly StructureGeometryInput[]): boolean {
  const pl = ctx.state.players.get(sid)!;
  return placementIsVisible({
    eye: placementEyePoint(pl.x, pl.y, pl.z, pl.crouch === true),
    candidate: { buildType: it.buildType as StructureGeometryInput["buildType"], grid: it.grid, rotation: it.rotation },
    structures,
  }).visible;
}

export interface BuildCtx {
  state: RoomStateSchemaInstance;
  bld: BuildingStateSchemaInstance;
  occ: Set<string>;
  lpt: Map<string, number>;
  tc: number;
  structureId: string;
  pwPromise: Promise<ServerPhysicsWorld>;
  broadcast: (ev: string, data: unknown) => void;
  sendTo: (c: Client, ev: string, data: unknown) => void;
}

export async function handleBuildPlacement(
  c: Client,
  msg: unknown,
  ctx: BuildCtx,
): Promise<void> {
  const sid = c.sessionId;
  const v = validateStructurePlacementIntent(msg);
  if (!v.ok) {
    const r = msg as Record<string, unknown> | null;
    const q = r && typeof r.sequence === "number" ? r.sequence : 0;
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: q, reason: "invalid_grid" });
    return;
  }
  const it = v.value;
  const pl = ctx.state.players.get(sid);
  if (!pl) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "invalid_grid" });
    return;
  }
  const cfg = getStructureConfig(it.buildType);
  if (!cfg) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "unknown_build_type" });
    return;
  }
  // Canonical rotation rule shared with the client preview: an integer in
  // [0, rotationCount) — rotation-invariant kinds place only with 0.
  if (!isValidPlacementRotation(it.buildType, it.rotation)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "invalid_grid" });
    return;
  }
  // Placement is accepted during the fight (IN_PROGRESS) AND during build
  // preparation (COUNTDOWN) — including the WAITING stretch before both
  // players have connected (the countdown itself stays frozen until then,
  // see TwoPlayerMovementRoom.tick). In any other phase it is refused as
  // before. Lifecycle persistence: structures accepted during ANY COUNTDOWN
  // stretch survive the gates-drop into IN_PROGRESS (the transition clears
  // prep constraints only; structure cleanup happens once per round
  // boundary), so early pre-builds carry into the fight.
  const phase = ctx.state.matchPhase as string;
  if (phase !== "IN_PROGRESS" && phase !== "COUNTDOWN") {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "rate_limited" });
    return;
  }
  if (!ib(it.grid, cfg, it.rotation)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "invalid_grid" });
    return;
  }
  // Preparation-row gate (CONTRACT.md §6): during COUNTDOWN the placement
  // anchor must lie in the player's ASSIGNED preparation row. Enemy and
  // centre rows are always denied, server-side, regardless of the client.
  if (phase === "COUNTDOWN" && !isGridAllowedDuringPreparation(it.grid, pl.preparationSide as PreparationSide | "")) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "preparation_zone" });
    return;
  }
  // Canonical range rule shared with the client preview (full 3D distance).
  if (!isWithinPlacementRange(pl, it.grid)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "out_of_range" });
    return;
  }
  const cells = oc(it.grid, cfg, it.rotation);
  for (const cell of cells)
    if (ctx.occ.has(cell)) {
      ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "overlap" });
      return;
    }
  // ── AUTHORITATIVE GEOMETRY GATES ── Everything below is recomputed from
  // the replicated structures + replicated player poses (never from a client
  // claim) on the canonical, edit-aware solids (`structureCuboids`), and all
  // of it runs BEFORE Energy is spent, before the structure exists, before
  // any physics write and before any broadcast — so a forged placement that
  // passes wire validation, bounds, prep-row, range and slot occupancy still
  // has zero side effects when the geometry refuses it.
  const geometry = { buildType: it.buildType as StructureGeometryInput["buildType"], grid: it.grid, rotation: it.rotation };
  const structures = existingStructureGeometry(ctx);
  // ACTOR OCCUPANCY (shared `placementActorsBlockCandidate`): a piece may not
  // be created inside a body. Sharing a build CELL is not overlap — only
  // canonical solid geometry that actually penetrates a capsule (the placer's
  // OR an opponent's, at the authoritative stance: standing / crouched /
  // mid-jump) rejects. A floor under the feet, a roof above the head, a wall
  // beside the capsule and the hollow under a cone stay legal.
  const occupancy = placementActorsBlockCandidate({
    candidate: geometry,
    actors: authoritativeActorPoses(ctx),
  });
  if (occupancy.blocked) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: occupancy.reason ?? "actor_overlap" });
    return;
  }
  // STRUCTURAL SUPPORT (shared `placementIsSupported`): the candidate must
  // attach — by a real face contact, honouring rotations and edited-out
  // geometry — to the arena build foundation or to a chain of existing pieces
  // that reaches it. A neighbour cell, an internally-connected but airborne
  // island, and a self-supporting cycle are all refused.
  if (!placementIsSupported({ candidate: geometry, structures }).supported) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "unsupported" });
    return;
  }
  const lt = ctx.lpt.get(sid);
  if (lt !== undefined && ctx.tc - lt < BUILD_RATE.minTicksBetweenPlacements) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "rate_limited" });
    return;
  }
  // Line-of-sight gate (occlusion mission): the candidate must be visible
  // from the authoritative eye against the canonical edited solids. A forged
  // in-range packet for a far-side-of-a-closed-wall slot is refused HERE —
  // before any Energy spend, structure creation, physics write or broadcast
  // — while a candidate seen through a real edited hole passes on the usual
  // rules alone. Ownership is irrelevant to obstruction.
  if (!placementHasLineOfSight(ctx, sid, it, structures)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "occluded" });
    return;
  }
  if (!canAffordBuild(pl.energy, cfg.cost)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "unaffordable" });
    return;
  }
  const id = ctx.structureId;
  const maxDur = getStructureDurability(it.buildType) ?? 100;
  const st = {
    structureId: id,
    buildType: it.buildType,
    grid: { x: it.grid.x, y: it.grid.y, z: it.grid.z },
    rotation: it.rotation,
    ownerId: sid,
    createdSequence: it.sequence,
  };
  const en = new StructureStateSchema();
  const gr = new StructureGridSchema();
  en.structureId = st.structureId;
  en.buildType = st.buildType;
  gr.x = st.grid.x;
  gr.y = st.grid.y;
  gr.z = st.grid.z;
  en.grid = gr;
  en.rotation = st.rotation;
  en.ownerId = st.ownerId;
  en.createdSequence = st.createdSequence;
  en.maxDurability = maxDur;
  en.currentDurability = maxDur;
  const initialEdit = createDefaultEditState(it.buildType);
  en.editKind = initialEdit.kind;
  en.editRampVariant = initialEdit.kind === "ramp" ? initialEdit.variant : "";
  if (initialEdit.kind !== "ramp") en.editTiles.push(...initialEdit.tiles);
  ctx.bld.structures.set(id, en);
  for (const cell of cells) ctx.occ.add(cell);
  ctx.lpt.set(sid, ctx.tc);
  pl.energy = computeEnergyAfterBuild(pl.energy, cfg.cost, ENERGY.maxEnergy);
  ctx.broadcast(ENERGY_EVENTS.ENERGY_UPDATE, { playerId: sid, energy: pl.energy });
  const pw = await ctx.pwPromise;
  pw.setStructureColliders(id, structureCuboids({ buildType: it.buildType, grid: it.grid, rotation: it.rotation }));
  ctx.broadcast(BUILD_EVENTS.STRUCTURE_PLACED, { structure: st });
}
