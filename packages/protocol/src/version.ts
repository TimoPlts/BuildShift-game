/**
 * Shared protocol version.
 *
 * Bumped to **0.2.0** (from the `0.1.0` scaffold) because this release
 * introduces the first concrete, shared network contract:
 *
 * - `PlayerInputFrame` (the authoritative movement-input contract) plus its
 *   structural validator,
 * - `AuthoritativePlayerState` (the minimal player state the server will
 *   expose), and
 * - the room / event identifiers.
 *
 * This is a **minor (feature) increment**: the `0.1.0` scaffold defined only
 * metadata (`PROTOCOL_VERSION`, `GameMode`) and no contract, so existing
 * consumers (which import only `PROTOCOL_VERSION`) keep working, and every new
 * export is purely additive. No previously-exported symbol was renamed or
 * removed.
 */
export const PROTOCOL_VERSION = "0.2.0" as const;
