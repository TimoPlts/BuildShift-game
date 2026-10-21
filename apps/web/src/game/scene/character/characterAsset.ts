/**
 * CharacterAsset — one loaded GLB/glTF rigged-humanoid asset.
 *
 * Loads a binary glTF (GLB) asset into an `AssetContainer` in memory and
 * exposes the asset-space bounding box of the loaded humanoid so
 * {@link CharacterModel} can normalise it deterministically (height,
 * centring, feet offset). The source hierarchy stays owned by the asset and
 * is hidden (never rendered); every player instance is a separate
 * `instantiateModelsToScene` clone.
 *
 * Loading is explicit and failure-safe: any parse, fetch, or shape failure
 * rejects with {@link CharacterAssetLoadError}. The presentation layer is
 * expected to treat that rejection as "fall back to the procedural
 * PlayerPresentation" (see {@link createCharacterPresentation}).
 *
 * The default asset is `public/assets/character/RiggedFigure.glb` — a
 * licensed (CC-BY 4.0) rigged/skinned test humanoid; see
 * `public/assets/character/ATTRIBUTION.md`.
 */
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { LoadAssetContainerAsync, SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import { GLTFFileLoader } from "@babylonjs/loaders/glTF";

/** URL of the default character asset, relative to the web app's public root. */
export const CHARACTER_ASSET_URL = "/assets/character/RiggedFigure.glb";

/** Thrown whenever the GLB asset cannot be loaded or is unusable. */
export class CharacterAssetLoadError extends Error {
  public constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CharacterAssetLoadError";
  }
}

/** Asset-space (unscaled) bounding box of the loaded humanoid. */
export interface CharacterAssetBounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

/**
 * Registers the GLB/glTF file loader once per process. Idempotent: safe to
 * call before every load, and a no-op when the extension is already served.
 */
function ensureGlTFLoaderPlugin(): void {
  if (!SceneLoader.IsPluginForExtensionAvailable(".glb")) {
    SceneLoader.RegisterPlugin(new GLTFFileLoader());
  }
}

/** The asset-space height (max.y - min.y) of a loaded humanoid. */
function assetHeight(bounds: CharacterAssetBounds): number {
  return bounds.max.y - bounds.min.y;
}

/**
 * World-space (in the container's source scene) bounds of every loaded
 * rendered mesh. Computed once at load time, at rest pose, so it is a
 * deterministic constant for a given asset file.
 */
function computeAssetBounds(container: AssetContainer): CharacterAssetBounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const node of container.rootNodes) {
    const all = [node, ...node.getDescendants()];
    for (const descendant of all) {
      if (!(descendant instanceof Mesh)) continue;
      descendant.computeWorldMatrix(true);
      const box = descendant.getBoundingInfo().boundingBox;
      min.x = Math.min(min.x, box.minimumWorld.x);
      min.y = Math.min(min.y, box.minimumWorld.y);
      min.z = Math.min(min.z, box.minimumWorld.z);
      max.x = Math.max(max.x, box.maximumWorld.x);
      max.y = Math.max(max.y, box.maximumWorld.y);
      max.z = Math.max(max.z, box.maximumWorld.z);
    }
  }
  return { min, max };
}

export class CharacterAsset {
  private constructor(
    /** Owns the source hierarchy, skeleton, and geometries. */
    readonly container: AssetContainer,
    readonly bounds: CharacterAssetBounds,
  ) {
    if (!Number.isFinite(assetHeight(bounds)) || assetHeight(bounds) <= 0) {
      throw new CharacterAssetLoadError(
        "character asset has no renderable volume",
      );
    }
  }

  /** Asset-space height in metres. */
  public get heightMeters(): number {
    return assetHeight(this.bounds);
  }

  /** Uniform scale factor that brings the asset height to the target. */
  public scaleForHeight(targetHeightMeters: number): number {
    if (!Number.isFinite(targetHeightMeters) || targetHeightMeters <= 0) {
      throw new CharacterAssetLoadError(
        `invalid target height: ${targetHeightMeters}`,
      );
    }
    return targetHeightMeters / this.heightMeters;
  }

  /**
   * Loads a GLB from an in-memory buffer. `scene` must be the scene that
   * will later host the player instances (the container's source hierarchy
   * is added there and hidden).
   */
  public static async fromBuffer(
    buffer: ArrayBuffer,
    scene: Scene,
  ): Promise<CharacterAsset> {
    ensureGlTFLoaderPlugin();
    let container: AssetContainer;
    try {
      container = await LoadAssetContainerAsync(
        new Uint8Array(buffer),
        scene,
        {
          rootUrl: "",
          name: "character.glb",
          pluginExtension: ".glb",
        },
      );
    } catch (error) {
      throw new CharacterAssetLoadError("failed to parse character GLB", error);
    }
    const roots = container.rootNodes;
    if (roots.length === 0) {
      container.dispose();
      throw new CharacterAssetLoadError(
        "character GLB contains no root node",
      );
    }
    const bounds = computeAssetBounds(container);
    // The source hierarchy is loaded into `scene` but must never render:
    // every rendered player is an instantiated clone.
    for (const root of roots) {
      root.setEnabled(false);
    }
    return new CharacterAsset(container, bounds);
  }

  /**
   * Fetches the GLB from `url` and loads it (browser path; tests use
   * {@link fromBuffer} with a file buffer directly).
   */
  public static async fromUrl(
    url: string,
    scene: Scene,
  ): Promise<CharacterAsset> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new CharacterAssetLoadError(`failed to fetch ${url}`, error);
    }
    if (!response.ok) {
      throw new CharacterAssetLoadError(
        `character GLB fetch failed: ${response.status} ${response.statusText}`.trim(),
      );
    }
    let buffer: ArrayBuffer;
    try {
      buffer = await response.arrayBuffer();
    } catch (error) {
      throw new CharacterAssetLoadError("failed to read character GLB body", error);
    }
    return CharacterAsset.fromBuffer(buffer, scene);
  }

  /**
   * Releases the asset. Instances must be disposed first (they share the
   * asset's geometries). Idempotent.
   */
  public dispose(): void {
    this.container.dispose();
  }
}
