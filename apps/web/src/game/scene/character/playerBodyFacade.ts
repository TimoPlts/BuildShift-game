/**
 * PlayerBodyFacade — the production player-body presentation seam
 * (Batch 2B, Task A).
 *
 * Both the local player (via `PlayerController`) and the remote player
 * (via `GameRuntime`) present through one facade per player:
 *
 *  - The facade starts with the procedural {@link PlayerPresentation} so the
 *    gameplay-mirror root exists synchronously (no matchmaking / first-frame
 *    dependency on the asset load) and so a genuine asset failure is
 *    automatically covered by the fallback.
 *  - `startCharacterLoad()` asynchronously loads the licensed
 *    `BuildShiftBaseCharacter.glb` (one normal production GLB presentation per player)
 *    through {@link createCharacterPresentation} and, when it succeeds,
 *    swaps the procedural body for the rigged {@link CharacterModel} with
 *    the exact same transform contract (root at the predicted/replicated
 *    position, shared yaw sign convention, feet-root alignment, crouch
 *    squash anchored at the feet).
 *  - The swap is seamless: the incoming body inherits the current root
 *    transform, crouch blend, and enabled state, and every EXTERNAL mount
 *    parented on the outgoing `visualRoot` (e.g. the weapon model) is
 *    re-parented onto the incoming `visualRoot` with its world transform
 *    preserved (Babylon keeps the world transform on re-parent). The
 *    outgoing body is then disposed, so there is exactly one rendered body
 *    at a time and no orphaned meshes, materials, or render observers.
 *  - If the load fails for ANY reason (fetch error, corrupt GLB, unusable
 *    shape), the procedural presentation simply stays and the failure
 *    reason is recorded on `fallbackReason` — the runtime never sees an
 *    error and gameplay timing never depends on the asset.
 *  - Loading is fire-and-forget: a facade disposed before the load settles
 *    disposes whatever the load produced, so no orphaned scene objects
 *    survive a runtime teardown mid-load.
 *
 * Presentation only: the facade never moves the player, never touches
 * prediction/reconciliation/colliders, and forwards every driving call to
 * the body that is currently rendered.
 *
 * Local view offset (`setLocalViewOffset`): a VISUAL-ONLY root-local X/Z
 * shift of the rendered body for local-avatar framing (crosshair stays at
 * the exact viewport centre; the local character is drawn aside). It is
 * applied exclusively to `visualRoot.position.x/z` (the body-owned feet /
 * crouch lift lives on `visualRoot.position.y` and is never touched), so
 * the gameplay-mirror `root` position/yaw, logical pose, collider, camera
 * feet position, network, physics, spawn, and server state are byte-for-byte
 * unaffected. The offset is per-facade state (remote avatars default to 0
 * and nothing forces it), it survives the procedural → rigged-GLB async
 * swap (re-applied to the incoming `visualRoot` before external mounts are
 * re-parented, so mounts keep their world transforms AND the visual shift),
 * and the setter is idempotent and safe after dispose.
 *
 * Animation: the adopted CharacterModel owns its original skeletal clips
 * and scene-frame driver. Both local/remote facades forward the canonical
 * position and crouch inputs; this facade never runs a second controller.
 */
import type { Scene } from "@babylonjs/core";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PlayerPresentation, type PlayerVariant } from "../PlayerPresentation";
import type { CharacterAsset } from "./characterAsset";
import type { CharacterModel, CharacterVariant } from "./CharacterModel";
import {
  createCharacterPresentation,
  type CharacterPresentation,
  type CreateCharacterPresentationOptions,
} from "./createCharacterPresentation";

/**
 * The presentation-only body contract shared by the procedural
 * {@link PlayerPresentation} and the rigged {@link CharacterModel}.
 *
 *  - `root` is the GAMEPLAY MIRROR: its position is the predicted /
 *    interpolated player position and its `rotation.y` is the NEGATED
 *    shared yaw (shared convention: 0 faces -Z, positive toward +X).
 *  - `visualRoot` is the presentation lift / crouch-squash node; external
 *    presentation mounts (weapon model, later effects) parent here so they
 *    follow the body and lower with crouch.
 *  - `applyState` implements the same frame-decay hit-flash contract the
 *    runtime already drives.
 */
export interface PlayerBodyPresentation {
  /** The gameplay-mirror root transform (never animated by presentation). */
  readonly root: TransformNode;
  /** The presentation lift / crouch-squash node (external mounts parent here). */
  readonly visualRoot: TransformNode;
  /** True once the body has been torn down; every method is then a no-op. */
  readonly isDisposed: boolean;
  /**
   * Moves the body to the predicted / interpolated position and faces it
   * along the shared movement yaw (yaw 0 = -Z, positive toward +X).
   */
  setTransform(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void;
  /** Dumb crouch applier for the blend in [0, 1] (feet-anchored squash). */
  setCrouchBlend(blend: number): void;
  /** Shows or hides the rendered body (the gameplay root keeps its transform). */
  setEnabled(enabled: boolean): void;
  /**
   * Applies the replicated presentation state and returns the remaining
   * hit-flash frame count (frame-decay contract).
   */
  applyState(wasEliminated: boolean, hitFlashFrames: number): number;
  /** Idempotent teardown of everything the body owns. */
  dispose(): void;
}

/**
 * One player's body: procedural until the rigged GLB body is ready (or the
 * load fails, in which case procedural for good). See the module docs.
 */
export class PlayerBodyFacade implements PlayerBodyPresentation {
  private readonly _scene: Scene;
  private readonly _variant: CharacterVariant;
  private readonly _namePrefix: string;
  private _current: PlayerBodyPresentation;
  private _asset: CharacterAsset | null = null;
  private _characterModel: CharacterModel | null = null;
  private _crouchBlend = 0;
  private _enabled = true;
  private _loadStarted = false;
  private _settledResolve: (() => void) | null = null;
  private readonly _settled: Promise<void>;
  private _fallbackReason: string | null = null;
  private _viewOffsetX = 0;
  private _viewOffsetZ = 0;
  private _disposed = false;

  /**
   * Creates the facade with the procedural body rendered immediately.
   * `namePrefix` prefixes every owned node name (e.g. "local-player" /
   * "remote-player").
   */
  public constructor(
    scene: Scene,
    variant: CharacterVariant,
    namePrefix: string,
  ) {
    this._scene = scene;
    this._variant = variant;
    this._namePrefix = namePrefix;
    this._current = PlayerPresentation.create(
      scene,
      variant as PlayerVariant,
      namePrefix,
    );
    this._settled = new Promise<void>((resolve) => {
      this._settledResolve = resolve;
    });
  }

  // --- PlayerBodyPresentation (forwarded to the rendered body) -----------

  public get root(): TransformNode {
    return this._current.root;
  }

  public get visualRoot(): TransformNode {
    return this._current.visualRoot;
  }

  public get isDisposed(): boolean {
    return this._disposed;
  }

  public setTransform(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    if (this._disposed) return;
    this._current.setTransform(position, yaw);
  }

  public setCrouchBlend(blend: number): void {
    if (this._disposed) return;
    this._crouchBlend = blend;
    this._current.setCrouchBlend(blend);
  }

  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    this._enabled = enabled;
    this._current.setEnabled(enabled);
  }

  public applyState(wasEliminated: boolean, hitFlashFrames: number): number {
    if (this._disposed) return hitFlashFrames;
    return this._current.applyState(wasEliminated, hitFlashFrames);
  }

  // --- Local view offset (visual only) ------------------------------------

  /**
   * Sets the VISUAL-ONLY local-avatar framing offset, in root-local units.
   *
   * The rendered body is shifted by (x, 0, z) in root-local space by
   * writing ONLY `visualRoot.position.x/z`. The body-owned feet/crouch
   * lift on `visualRoot.position.y`, the gameplay-mirror `root`
   * (position + yaw), logical pose, collider, camera feet position,
   * network, physics, spawn, and server state are never touched. External
   * mounts parented on `visualRoot` (weapon model, effects) follow the
   * visual shift automatically.
   *
   * Sign convention (proved against cardinal vectors in the facade tests):
   * the gameplay root carries `rotation.y = -yaw` and the body faces
   * shared-yaw 0 = -Z, so root-local +X projects onto screen-LEFT for the
   * centre-aligned local camera (which looks along the character's -Z
   * forward) at ANY yaw — the shift stays screen-consistent while the
   * character turns. So `setLocalViewOffset(+0.8, 0)` frames the local
   * character 0.8 units to the screen-left of the fixed centre crosshair.
   *
   * Stable contract: defaults to (0, 0) for every facade (remote avatars
   * default to 0 and nothing forces it), the offset persists across the async
   * GLB adoption/fallback swap and every crouch/animation/material update,
   * and calls after `dispose()` are safe no-ops.
   *
   * FEET-ANCHOR WARNING (anchored-turn 20261126): because the offset lives
   * UNDER the yaw-rotated root, a non-zero value translates the RENDERED
   * body's world position by `R(yaw)·(x, 0, z)` — the rendered feet then
   * orbit the collider feet as yaw changes (the reported stationary-mouse-turn
   * "character swings through space" drift). With the camera pinned to the
   * centred shot line through the feet there is no yaw-invariant lateral body
   * offset: the production local wiring (THIRD_PERSON_CAMERA
   * .localViewOffsetX/Z) is therefore 0 and must stay 0; this API stays for
   * per-facade presentation experiments only (remotes default to 0).
   */
  public setLocalViewOffset(x: number, z: number = 0): void {
    if (this._disposed) return;
    this._viewOffsetX = Number.isFinite(x) ? x : 0;
    this._viewOffsetZ = Number.isFinite(z) ? z : 0;
    this._applyViewOffset();
  }

  /** The current visual-only root-local view offset (never mutated by callers). */
  public get localViewOffset(): Readonly<{ x: number; z: number }> {
    return { x: this._viewOffsetX, z: this._viewOffsetZ };
  }

  // --- Character load / swap --------------------------------------------

  /** True once the rigged GLB body is the rendered body. */
  public get isCharacterLoaded(): boolean {
    return this._characterModel !== null;
  }

  /**
   * The concrete rigged body once loaded (presentation-only seam for the
   * later animation work; `null` while the procedural body is rendered).
   */
  public get characterModel(): CharacterModel | null {
    return this._characterModel;
  }

  /** Why the GLB body was not adopted (asset failure), or `null`. */
  public get fallbackReason(): string | null {
    return this._fallbackReason;
  }

  /** The body currently rendered (procedural until the GLB swap). */
  public get currentBody(): PlayerBodyPresentation {
    return this._current;
  }

  /** Resolves once the character load has settled (success or fallback). */
  public whenCharacterSettled(): Promise<void> {
    return this._settled;
  }

  /**
   * Starts the non-blocking character load. Idempotent: a second call is
   * ignored, and a disposed facade never loads. The caller never has to
   * handle the result — success swaps the body, failure keeps the
   * procedural one with the reason recorded.
   */
  public startCharacterLoad(
    options: CreateCharacterPresentationOptions = {},
  ): void {
    if (this._disposed || this._loadStarted) return;
    this._loadStarted = true;
    void createCharacterPresentation(
      this._scene,
      this._variant,
      this._namePrefix,
      options,
    ).then(
      (result) => this._settle(result),
      (error: unknown) => {
        // Only reachable if even the procedural fallback construction
        // throws (a hard scene error); the provisional body is still ours.
        this._settleFailed(
          `character presentation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }

  // --- teardown ----------------------------------------------------------

  /**
   * Idempotent teardown: disposes the rendered body (procedural or rigged),
   * the loaded asset when present, and settles the load promise so a late
   * resolution disposes its product instead of orphaning it.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._current.dispose();
    this._asset?.dispose();
    this._asset = null;
    this._settledResolve?.();
  }

  // --- internals ----------------------------------------------------------

  private _settle(result: CharacterPresentation): void {
    if (this._disposed) {
      // The facade went away mid-load: release whatever the load produced.
      if (result.kind === "character") {
        result.model.dispose();
        result.asset.dispose();
      } else {
        result.presentation.dispose();
      }
      this._settledResolve?.();
      return;
    }
    if (result.kind === "character") {
      this._asset = result.asset;
      this._characterModel = result.model;
      this._swapBody(result.model);
    } else {
      // Genuine asset failure: the explicit fallback is the procedural body.
      // createCharacterPresentation built a fresh one for this prefix; adopt
      // it so exactly one procedural body exists (no duplicate meshes).
      this._fallbackReason = result.reason;
      this._swapBody(result.presentation);
    }
    this._settledResolve?.();
  }

  private _settleFailed(reason: string): void {
    if (!this._disposed) {
      this._fallbackReason = reason;
      // Keep the provisional procedural body (already the fallback).
    }
    this._settledResolve?.();
  }

  /**
   * Replaces the rendered body: the incoming body inherits the current
   * gameplay transform, crouch, and visibility; external mounts move with
   * their world transforms preserved; the outgoing body is disposed.
   */
  private _swapBody(incoming: PlayerBodyPresentation): void {
    const outgoing = this._current;

    // 1. Carry over the canonical gameplay transform (shared yaw convention:
    //    root.rotation.y is the NEGATED yaw, so the shared yaw is its flip).
    incoming.setTransform(outgoing.root.position, -outgoing.root.rotation.y);

    // 2. Carry over the presentation state (feet-anchored crouch squash and
    //    visibility use the identical mapping on both body types).
    incoming.setCrouchBlend(this._crouchBlend);
    incoming.setEnabled(this._enabled);

    // 2b. Carry over the visual-only view offset BEFORE re-parenting the
    //     mounts, so the two visualRoots carry identical world transforms
    //     and the mounts keep their exact local mount positions (step 3).
    this._applyViewOffsetTo(incoming.visualRoot);

    // 3. Move every external mount from the outgoing visualRoot to the
    //    incoming one. Babylon preserves a node's WORLD transform on
    //    re-parent, and the two visualRoots now carry identical transforms
    //    (steps 1-2), so the mounts keep their exact local mount positions.
    //    (The outgoing body's own internals are also moved here but are
    //    disposed by step 4; nothing external is left behind.)
    for (const child of outgoing.visualRoot.getChildTransformNodes(true)) {
      child.setParent(incoming.visualRoot);
    }

    // 4. Release the outgoing body (meshes, materials, render observer,
    //    and its transform nodes) so exactly one body renders per player.
    outgoing.dispose();
    this._current = incoming;
  }

  /**
   * Writes the stored view offset onto the CURRENT body's visualRoot.
   * Only x/z are written: `visualRoot.position.y` is the body's own
   * feet-alignment / crouch lift and stays under the body's control.
   */
  private _applyViewOffset(): void {
    this._applyViewOffsetTo(this._current.visualRoot);
  }

  private _applyViewOffsetTo(visualRoot: TransformNode): void {
    visualRoot.position.x = this._viewOffsetX;
    visualRoot.position.z = this._viewOffsetZ;
  }
}
