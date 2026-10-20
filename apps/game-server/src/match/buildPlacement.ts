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
} from "@buildshift/game-config";
import {
  StructureStateSchema,
  StructureGridSchema,
  ib,
  oc,
} from "../state/buildingState.js";
import type { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";
import type { BuildingStateSchemaInstance } from "../state/buildingState.js";

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
  if (ctx.state.matchPhase !== "IN_PROGRESS") {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "rate_limited" });
    return;
  }
  if (!ib(it.grid, cfg, it.rotation)) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "invalid_grid" });
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
  const lt = ctx.lpt.get(sid);
  if (lt !== undefined && ctx.tc - lt < BUILD_RATE.minTicksBetweenPlacements) {
    ctx.sendTo(c, BUILD_EVENTS.STRUCTURE_REJECTED, { sequence: it.sequence, reason: "rate_limited" });
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
