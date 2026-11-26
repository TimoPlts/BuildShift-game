/**
 * Public entry point for the combat presentation-orchestration modules.
 *
 * These small client-side modules own the *feel* of combat presentation that
 * the `GameRuntime` wires through the canonical `App -> GameCanvas ->
 * GameRuntime -> NetworkClient` path:
 *
 *  - {@link CameraRecoil} — the modular, per-weapon camera-recoil model,
 *  - {@link resolveStructureImpactPosition} — derives a build-impact
 *    presentation position from the replicated building state,
 *  - {@link HeldFirePresentationGate} — the per-weapon, tick-based gate that
 *    decides which simulation-tick fire intents present a local round
 *    (held automatic fire shares the shot feedback with the click edge).
 *
 * Neither module is authoritative: they are pure presentation helpers that
 * never touch gameplay, network authority, or scene objects.
 */
export {
  CameraRecoil,
  DEFAULT_RECOIL_CONFIG,
  type RecoilConfig,
} from "./cameraRecoil";

export {
  resolveStructureImpactPosition,
  type WorldPoint,
} from "./structureImpactPosition";

export {
  HeldFirePresentationGate,
  type HeldFirePresentationRequest,
} from "./heldFirePresentation";
