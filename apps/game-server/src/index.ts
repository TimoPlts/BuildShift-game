/**
 * Game server entry point (placeholder).
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.2 this app owns the authoritative
 * simulation, input validation, match lifecycle, and Colyseus rooms. None of
 * that is implemented yet — this entry point only proves the package
 * compiles and runs under Node.js and that the shared workspace packages
 * resolve.
 */
import { PROTOCOL_VERSION } from "@buildshift/protocol";

function main(): void {
  console.log("[buildshift:game-server] server entry point started (placeholder)");
  console.log(`[buildshift:game-server] protocol version: ${PROTOCOL_VERSION}`);
  console.log("[buildshift:game-server] Colyseus rooms are not yet implemented.");
}

main();
