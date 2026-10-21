/**
 * Rigged GLB character presentation pipeline (Batch 2A, Task A).
 *
 *  - `characterAsset` — in-memory GLB/glTF loading (`CharacterAsset`),
 *    asset-space bounds, and the explicit `CharacterAssetLoadError` contract.
 *  - `CharacterModel` — one per-player instance: independent clone,
 *    deterministic scale/centring/feet alignment to the predicted position,
 *    variant material assignment, idempotent disposal. Transform contract
 *    identical to `PlayerPresentation`.
 *  - `createCharacterPresentation` — factory with explicit graceful fallback
 *    to the procedural `PlayerPresentation`.
 */
export {
  CharacterAsset,
  CharacterAssetLoadError,
  CHARACTER_ASSET_URL,
  type CharacterAssetBounds,
} from "./characterAsset";
export {
  CharacterModel,
  type CharacterModelOptions,
  type CharacterVariant,
} from "./CharacterModel";
export {
  createCharacterPresentation,
  type CharacterPresentation,
  type CreateCharacterPresentationOptions,
} from "./createCharacterPresentation";
