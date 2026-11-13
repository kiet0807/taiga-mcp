import { ConfigError, normalizeBaseUrl, read, type Env } from '../config.js';

/** What the hosted server needs to know. Read once from the environment at start-up. */
export interface RemoteConfig {
  /**
   * The Taiga this server signs people in to. With `anyTaiga` it is only the address suggested
   * on the sign-in page, and may be missing.
   */
  readonly taigaUrl: string | undefined;
  /** Each person types the address of their own Taiga. */
  readonly anyTaiga: boolean;
  /** The address people reach this server at, e.g. https://taiga-mcp.example.com. No path. */
  readonly publicUrl: URL;
  /** Key material for everything the server seals. Changing it signs everyone out. */
  readonly secret: string;
  readonly port: number;
  /** How many proxies sit in front of the server (so the visitor's address is read correctly). */
  readonly trustProxy: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function wholeNumber(env: Env, key: string, fallback: number): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new ConfigError(`${key} must be a whole number.`);
  return value;
}

export function loadRemoteConfig(env: Env = process.env): RemoteConfig {
  const rawAny = read(env, 'ANY_TAIGA')?.toLowerCase();
  if (rawAny !== undefined && !['true', 'false', '1', '0'].includes(rawAny)) {
    throw new ConfigError('ANY_TAIGA must be true or false.');
  }
  const anyTaiga = rawAny === 'true' || rawAny === '1';

  const rawTaiga = read(env, 'TAIGA_URL');
  if (!rawTaiga && !anyTaiga) {
    throw new ConfigError(
      'TAIGA_URL is not set. Set it to your Taiga API host, e.g. https://api.taiga.io, or set ANY_TAIGA=true to let each person name their own Taiga.',
    );
  }

  const rawPublic = read(env, 'PUBLIC_URL');
  if (!rawPublic) {
    throw new ConfigError(
      'PUBLIC_URL is not set. Set it to the address people reach this server at, e.g. https://taiga-mcp.example.com',
    );
  }
  let publicUrl: URL;
  try {
    publicUrl = new URL(rawPublic);
  } catch {
    throw new ConfigError(`PUBLIC_URL is not a valid address: "${rawPublic}".`);
  }
  const local = LOCAL_HOSTS.has(publicUrl.hostname);
  if (publicUrl.protocol !== 'https:' && !(local && publicUrl.protocol === 'http:')) {
    throw new ConfigError('PUBLIC_URL must start with https:// (http:// is accepted for localhost only).');
  }
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new ConfigError(
      'PUBLIC_URL must be the bare address, without a path: https://taiga-mcp.example.com',
    );
  }

  const secret = read(env, 'MCP_SECRET');
  if (secret === undefined || secret.length < 32) {
    throw new ConfigError(
      'MCP_SECRET must be set to a random value of at least 32 characters, e.g. the output of `openssl rand -base64 48`.',
    );
  }

  return {
    taigaUrl: rawTaiga ? normalizeBaseUrl(rawTaiga) : undefined,
    anyTaiga,
    publicUrl,
    secret,
    port: wholeNumber(env, 'PORT', 3000),
    // A hosted server sits behind the host's proxy; a local one is reached directly.
    trustProxy: wholeNumber(env, 'TRUST_PROXY', local ? 0 : 1),
  };
}
