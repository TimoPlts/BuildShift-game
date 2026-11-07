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
  LOCAL_MATERIAL_SCHEME,
  REMOTE_MATERIAL_SCHEME,
  characterMaterialScheme,
  tintedBaseDiffuse,
  readDiffuse,
  writeDiffuse,
  writeEmissive,
  applyMaterialScheme,
  resetMaterialScheme,
  type CharacterMaterialScheme,
} from "./characterMaterialVariation";
export {
  createCharacterPresentation,
  type CharacterPresentation,
  type CreateCharacterPresentationOptions,
} from "./createCharacterPresentation";
export {
  PlayerBodyFacade,
  type PlayerBodyPresentation,
} from "./playerBodyFacade";
export {
  CharacterWeaponAttachment,
  findCharacterHandSocket,
  DEFAULT_FALLBACK_SOCKET_POSITION,
  DEFAULT_WEAPON_HOLD_OFFSET,
  type WeaponAttachmentOptions,
  type WeaponAttachmentSocketSource,
  type Vector3Like,
} from "./CharacterWeaponAttachment";
