import { TaigaError } from '../taiga/http.js';

/** The tokens Taiga hands out at sign-in. Old Taiga versions have no refresh token. */
export interface TaigaTokens {
  readonly token: string;
  readonly refresh: string | undefined;
}

const TIMEOUT_MS = 15_000;

/** Sign-in and token renewal against one Taiga, on behalf of whoever is at the sign-in page. */
export class TaigaAuth {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
  }

  /** `undefined` when Taiga does not accept the username and password. Throws when Taiga cannot say. */
  async signIn(username: string, password: string): Promise<TaigaTokens | undefined> {
    const response = await this.#post('/auth', { type: 'normal', username, password });
    // Taiga 6 answers 401 to a wrong password, older versions 400.
    if (response.status === 400 || response.status === 401) return undefined;
    if (response.status === 429) {
      throw new TaigaError('Taiga is refusing sign-ins for the moment (too many attempts).', 429);
    }
    if (!response.ok)
      throw new TaigaError(`Taiga answered ${response.status} to the sign-in.`, response.status);
    return tokensOf(await response.json());
  }

  /** A new pair for a refresh token, or `undefined` when Taiga no longer accepts it. */
  async refresh(refresh: string): Promise<TaigaTokens | undefined> {
    const response = await this.#post('/auth/refresh', { refresh });
    if (response.status === 400 || response.status === 401) return undefined;
    if (!response.ok)
      throw new TaigaError(`Taiga answered ${response.status} to the renewal.`, response.status);
    return tokensOf(await response.json());
  }

  async #post(path: string, body: unknown): Promise<Response> {
    try {
      return await this.#fetch(new URL(`${this.#baseUrl}/api/v1${path}`), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaigaError(`Could not reach Taiga at ${this.#baseUrl} (${reason}).`);
    }
  }
}

function tokensOf(body: unknown): TaigaTokens {
  const { auth_token: token, refresh } = (body ?? {}) as { auth_token?: unknown; refresh?: unknown };
  if (typeof token !== 'string' || token === '') throw new TaigaError('Taiga signed in without a token.');
  return { token, refresh: typeof refresh === 'string' && refresh !== '' ? refresh : undefined };
}

/**
 * When a Taiga token stops working, in seconds since the epoch, read from the token itself
 * (Taiga 6 tokens are JWTs). `undefined` for tokens that do not say.
 */
export function tokenExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}
