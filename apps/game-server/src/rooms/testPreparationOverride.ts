/**
 * Server-owned test override for the build preparation countdown
 * (CONTRACT.md §7).
 *
 * WHY THIS EXISTS
 * The preparation phase is authoritative server state: both players always get
 * the same full `BOX_FIGHT_PREPARATION.durationSeconds` (8 s). Integration tests
 * need a shorter countdown, but a plain join option would be a public
 * denial-of-fairness vector — Colyseus 0.18 hands `onCreate`
 * `merge({}, clientOptions, handler.options)` (`@colyseus/core/src/MatchMaker.ts`,
 * a SHALLOW key assignment), so ANY option name the server does not pin can be
 * supplied by the client, and a client-supplied boolean guard would be just as
 * spoofable.
 *
 * THE GUARD
 * A short preparation is honoured only when `onCreate` receives a capability
 * TOKEN that this module actually issued. Tokens are random UUIDs created by
 * `issueTestPreparationOverride()` — called exclusively from server-side
 * registration (`server.define()` handler options in `createServer`) — and are
 * never sent to clients. The duration itself is resolved SERVER-SIDE from the
 * token, so even a client that knew a token could not pick its own length. The
 * production registration additionally pins the option key to an empty string,
 * which the shallow merge assigns over any client-sent token.
 */
import { randomUUID } from "node:crypto";

/** Option key carrying the server-issued test-preparation capability token. */
export const TEST_PREPARATION_TOKEN_OPTION = "__testPreparationToken";

/** Issued capability token → preparation length in seconds (server-side only). */
const issued = new Map<string, number>();

/** Normalise a requested test duration; `undefined` = not a valid override. */
export function normalizeTestPreparationSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Issue a one-purpose capability token bound to a preparation length.
 * SERVER-SIDE ONLY: call it from test setup that constructs the server, never
 * from anything reachable by a client.
 */
export function issueTestPreparationOverride(seconds: unknown): string | undefined {
  const normalized = normalizeTestPreparationSeconds(seconds);
  if (normalized === undefined) return undefined;
  const token = randomUUID();
  issued.set(token, normalized);
  return token;
}

/**
 * Resolve the preparation length a room instance must use, from its `onCreate`
 * options. Returns `undefined` (→ caller uses the authoritative 8 s) unless the
 * token was genuinely issued by this process.
 */
export function resolveTestPreparationSeconds(options?: Record<string, unknown>): number | undefined {
  const token = options?.[TEST_PREPARATION_TOKEN_OPTION];
  return typeof token === "string" ? issued.get(token) : undefined;
}

/** Test introspection: whether a token is currently armed (never exposed remotely). */
export function hasTestPreparationOverride(token: unknown): boolean {
  return typeof token === "string" && issued.has(token);
}
