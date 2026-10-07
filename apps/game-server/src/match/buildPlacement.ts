import type { Client } from "@colyseus/core";
import type { RoomStateSchemaInstance } from "@buildshift/protocol";
import {
  validateStructurePlacementIntent,
  canAffordBuild,
  computeEnergyAfterBuild,
  ENERGY_EVENTS,
  BUILD_EVENTS,
} from "@buildshift/protocol";
import {
  BUILD_GRID,
  BUILD_RANGE,
  BUILD_RATE,
  getStructureConfig,
  ENERGY,
  getStructureDurability,
} from "@buildshift/game-config";
import {
  StructureStateSchema,
  StructureGridSchema,
  ib,
  oc,
  wc,
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
  if (cfg.rotationCount === 1 && it.rotation !== 0) {
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
  const ax = it.grid.x * BUILD_GRID.cellSize;
  const ay = it.grid.y * BUILD_GRID.layerHeight;
  const az = it.grid.z * BUILD_GRID.cellSize;
  const dx = pl.x - ax, dy = pl.y - ay, dz = pl.z - az;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > BUILD_RANGE.maxPlacementDistance) {
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
  ctx.bld.structures.set(id, en);
  for (const cell of cells) ctx.occ.add(cell);
  ctx.lpt.set(sid, ctx.tc);
  pl.energy = computeEnergyAfterBuild(pl.energy, cfg.cost, ENERGY.maxEnergy);
  ctx.broadcast(ENERGY_EVENTS.ENERGY_UPDATE, { playerId: sid, energy: pl.energy });
  const pw = await ctx.pwPromise;
  const wco = wc(it.grid, cfg, it.rotation);
  pw.addStructureCollider(id, wco.ctr, wco.he);
  ctx.broadcast(BUILD_EVENTS.STRUCTURE_PLACED, { structure: st });
}
