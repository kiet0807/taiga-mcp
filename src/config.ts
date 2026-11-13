/** How to reach Taiga and sign in. Read once from the environment at start-up. */
export interface TaigaConfig {
  /** Origin of the Taiga API host, without a trailing slash and without `/api/v1`. */
  readonly baseUrl: string;
  /** Username and password: the server signs in by itself and signs in again when tokens expire. */
  readonly credentials?: { readonly username: string; readonly password: string };
  /** Tokens obtained elsewhere, used as they are. Without credentials, an expired pair ends the session. */
  readonly token?: string;
  readonly refreshToken?: string;
  /**
   * What to tell the person when the token has expired and cannot be renewed. The default
   * names the environment variables, which means nothing to someone using the hosted server.
   */
  readonly expiredHint?: string;
  /**
   * Allow the tools that create and change items, and comment. Off unless asked for. Nothing can
   * be deleted either way: the server has no way to send a delete.
   */
  readonly write?: boolean;
}

/** A problem with the environment variables. The message says what to set; it never echoes a secret. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export type Env = Readonly<Record<string, string | undefined>>;

/** An unset variable and an empty one (`TAIGA_TOKEN=` in a .env file) mean the same thing. */
export function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** A switch: true or false (also 1 or 0), off when unset. */
export function flag(env: Env, key: string): boolean {
  const raw = read(env, key)?.toLowerCase();
  if (raw === undefined) return false;
  if (!['true', 'false', '1', '0'].includes(raw)) throw new ConfigError(`${key} must be true or false.`);
  return raw === 'true' || raw === '1';
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`TAIGA_URL is not a valid address: "${raw}". Example: https://api.taiga.io`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('TAIGA_URL must start with https:// (or http:// for a local Taiga).');
  }
  // People paste the address with or without the API path; both mean the same host.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.origin}${path}`;
}

export function loadConfig(env: Env = process.env): TaigaConfig {
  const rawUrl = read(env, 'TAIGA_URL');
  if (!rawUrl) {
    throw new ConfigError('TAIGA_URL is not set. Set it to your Taiga API host, e.g. https://api.taiga.io');
  }
  const baseUrl = normalizeBaseUrl(rawUrl);

  const username = read(env, 'TAIGA_USERNAME');
  const password = read(env, 'TAIGA_PASSWORD');
  const token = read(env, 'TAIGA_TOKEN');
  const refreshToken = read(env, 'TAIGA_REFRESH_TOKEN');

  if ((username === undefined) !== (password === undefined)) {
    throw new ConfigError('Set both TAIGA_USERNAME and TAIGA_PASSWORD, or neither.');
  }
  if (username === undefined && token === undefined) {
    throw new ConfigError('No way to sign in: set TAIGA_USERNAME and TAIGA_PASSWORD, or TAIGA_TOKEN.');
  }
  const write = flag(env, 'TAIGA_WRITE');

  return {
    baseUrl,
    ...(username !== undefined && password !== undefined ? { credentials: { username, password } } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(write ? { write } : {}),
  };
}
