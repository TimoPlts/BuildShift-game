/**
 * createCharacterPresentation — explicit graceful-fallback factory for the
 * rigged GLB character pipeline.
 *
 * Tries to load the licensed character asset and build a
 * {@link CharacterModel} instance; on ANY failure (fetch error, corrupt or
 * missing GLB, unusable shape) it falls back to the existing procedural
 * {@link PlayerPresentation} with the same variant and name prefix, and
 * reports the failure reason so a future diagnostic panel can surface it.
 * The caller only ever receives a ready-to-drive presentation — gameplay
 * timing never depends on the asset load.
 */
import type { Scene } from "@babylonjs/core";
import { PlayerPresentation, type PlayerVariant } from "../PlayerPresentation";
import {
  CHARACTER_ASSET_URL,
  CharacterAsset,
  CharacterAssetLoadError,
  defaultCharacterAssetOrientationYawOffset,
} from "./characterAsset";
import { CharacterModel, type CharacterVariant } from "./CharacterModel";

/** The outcome of a character-presentation build. */
export type CharacterPresentation =
  | {
      readonly kind: "character";
      /** The rigged GLB presentation instance. */
      readonly model: CharacterModel;
      /** The shared loaded asset (dispose AFTER all instances). */
      readonly asset: CharacterAsset;
    }
  | {
      readonly kind: "fallback";
      /** The procedural presentation driving the player instead. */
      readonly presentation: PlayerPresentation;
      /** Why the GLB pipeline fell back (explicit, not silent). */
      readonly reason: string;
    };

/** Options for {@link createCharacterPresentation}. */
export interface CreateCharacterPresentationOptions {
  /** Override the default asset URL (e.g. for tests or swaps). */
  readonly assetUrl?: string;
  /** Forwarded to {@link CharacterModel.create}. */
  readonly targetHeightMeters?: number;
  /** Forwarded to {@link CharacterModel.create}. */
  readonly orientationYawOffset?: number;
}

/**
 * Builds the rigged character presentation when the asset loads, otherwise
 * the procedural fallback. Never rejects — every failure path yields the
 * fallback (unless even the fallback scene setup throws, which is a hard
 * scene error and propagates).
 */
export async function createCharacterPresentation(
  scene: Scene,
  variant: CharacterVariant,
  namePrefix: string,
  options: CreateCharacterPresentationOptions = {},
): Promise<CharacterPresentation> {
  try {
    const asset = await CharacterAsset.fromUrl(
      options.assetUrl ?? CHARACTER_ASSET_URL,
      scene,
    );
    const model = await CharacterModel.create(
      scene,
      asset,
      variant,
      namePrefix,
      {
        targetHeightMeters: options.targetHeightMeters,
        // Asset-specific orientation metadata: the shipped default rig
        // carries its measured anatomical-front correction; an explicit
        // caller override always wins. This is presentation normalisation
        // only — the shared gameplay yaw convention is untouched.
        orientationYawOffset:
          options.orientationYawOffset ??
          defaultCharacterAssetOrientationYawOffset(
            options.assetUrl ?? CHARACTER_ASSET_URL,
          ),
      },
    );
    return { kind: "character", model, asset };
  } catch (error) {
    const reason =
      error instanceof CharacterAssetLoadError
        ? error.message
        : `character pipeline failed: ${error instanceof Error ? error.message : String(error)}`;
    const presentation = PlayerPresentation.create(
      scene,
      variant as PlayerVariant,
      namePrefix,
    );
    return { kind: "fallback", presentation, reason };
  }
}
