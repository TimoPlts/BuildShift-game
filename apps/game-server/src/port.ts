const LOG_PREFIX = "[buildshift:game-server]";
export const DEFAULT_PORT = 2567;

export interface PortEnvironment {
  GAME_SERVER_PORT?: string;
  PORT?: string;
}

/**
 * Resolve the listen port with `GAME_SERVER_PORT` → `PORT` → default
 * precedence. Only complete base-10 integer strings in the TCP port range are
 * accepted; values such as `2567abc`, `1.5`, and `1e3` fall through instead
 * of being partially parsed.
 */
export function resolvePort(
  environment: PortEnvironment = process.env,
): number {
  const candidates = [
    environment.GAME_SERVER_PORT,
    environment.PORT,
    String(DEFAULT_PORT),
  ];

  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) {
      continue;
    }

    if (/^[0-9]+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) {
        return parsed;
      }
    }

    console.warn(
      `${LOG_PREFIX} ignoring invalid port value "${raw}" (expected an integer from 1 through 65535)`,
    );
  }

  return DEFAULT_PORT;
}
