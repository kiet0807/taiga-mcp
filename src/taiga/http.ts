import type { TaigaConfig } from '../config.js';
import type { RawAuth } from './types.js';

/** A failed call to Taiga, worded so that the model (and the person reading its answer) can act on it. */
export class TaigaError extends Error {
  override readonly name = 'TaigaError';
  constructor(
    message: string,
    /** HTTP status, when Taiga answered at all. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export type Query = Readonly<Record<string, string | number | boolean | undefined>>;

/** The first items of a long list, and how many items the list has in all. */
export interface Page<T> {
  readonly items: T[];
  readonly total: number;
}

const TIMEOUT_MS = 15_000;

/**
 * The only place that talks to Taiga. It signs in on first use, keeps the tokens in memory,
 * and renews them once when Taiga answers 401. Read-only: it sends GET requests, plus the two
 * POSTs of the sign-in itself.
 */
export class TaigaHttp {
  readonly #config: TaigaConfig;
  readonly #fetch: typeof fetch;
  #token: string | undefined;
  #refreshToken: string | undefined;
  /** A sign-in in flight, shared by the calls that are waiting for it. */
  #signingIn: Promise<string> | undefined;

  constructor(config: TaigaConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#token = config.token;
    this.#refreshToken = config.refreshToken;
  }

  /** One object, or a list that is known to be short (`everything` asks Taiga for all of it at once). */
  async get<T>(path: string, query: Query = {}, options: { everything?: boolean } = {}): Promise<T> {
    // Taiga pages lists by 30 unless told otherwise.
    const headers: Record<string, string> = options.everything ? { 'x-disable-pagination': 'True' } : {};
    const response = await this.#request(path, query, headers);
    return (await response.json()) as T;
  }

  /** The first `limit` items of a list that may be long. Taiga reports the full count in a header. */
  async page<T>(path: string, query: Query, limit: number): Promise<Page<T>> {
    const response = await this.#request(path, { ...query, page_size: limit }, {});
    const items = (await response.json()) as T[];
    const count = Number(response.headers.get('x-pagination-count') ?? Number.NaN);
    return { items, total: Number.isFinite(count) ? Math.max(count, items.length) : items.length };
  }

  /* ------------------------------ requests ------------------------------ */

  async #request(path: string, query: Query, headers: Record<string, string>): Promise<Response> {
    let response = await this.#send(path, query, { ...headers, ...this.#bearer(await this.#currentToken()) });
    if (response.status === 401) {
      response = await this.#send(path, query, { ...headers, ...this.#bearer(await this.#renewToken()) });
    }
    if (!response.ok) throw await this.#failure(response, path);
    return response;
  }

  #bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async #send(
    path: string,
    query: Query,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const url = new URL(`${this.#config.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      return await this.#fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaigaError(`Could not reach Taiga at ${this.#config.baseUrl} (${reason}). Check TAIGA_URL.`);
    }
  }

  async #failure(response: Response, path: string): Promise<TaigaError> {
    const { status } = response;
    if (status === 401) {
      return new TaigaError(
        'Taiga did not accept the sign-in. Check the credentials in the environment.',
        401,
      );
    }
    if (status === 403) return new TaigaError(`The signed-in user may not read ${path} in Taiga.`, 403);
    if (status === 404) return new TaigaError(`Taiga has nothing at ${path}.`, 404);
    if (status === 429)
      return new TaigaError('Taiga is rate-limiting requests. Wait a moment and try again.', 429);
    // Taiga explains most client errors in `_error_message`.
    const detail = await response
      .json()
      .then((data: unknown) =>
        typeof data === 'object' && data !== null && '_error_message' in data
          ? String(data._error_message)
          : '',
      )
      .catch(() => '');
    return new TaigaError(`Taiga answered ${status} for ${path}${detail ? `: ${detail}` : ''}.`, status);
  }

  /* ------------------------------- sign-in ------------------------------- */

  async #currentToken(): Promise<string> {
    return this.#token ?? this.#signIn();
  }

  /** After a 401: try the refresh token, then the username and password. */
  async #renewToken(): Promise<string> {
    const refresh = this.#refreshToken;
    this.#token = undefined;
    if (refresh !== undefined) {
      const response = await this.#send('/auth/refresh', {}, {}, { refresh });
      if (response.ok) return this.#remember((await response.json()) as RawAuth);
      this.#refreshToken = undefined;
    }
    return this.#signIn();
  }

  #signIn(): Promise<string> {
    this.#signingIn ??= this.#signInOnce().finally(() => {
      this.#signingIn = undefined;
    });
    return this.#signingIn;
  }

  async #signInOnce(): Promise<string> {
    const { credentials } = this.#config;
    if (credentials === undefined) {
      throw new TaigaError(
        'The Taiga token has expired and cannot be renewed. Set a new TAIGA_TOKEN, or set TAIGA_USERNAME and TAIGA_PASSWORD so the server can sign in by itself.',
        401,
      );
    }
    const response = await this.#send('/auth', {}, {}, { type: 'normal', ...credentials });
    if (!response.ok) {
      // Deliberately generic: the response body may repeat what was sent.
      throw new TaigaError(
        `Taiga sign-in failed (${response.status}). Check TAIGA_USERNAME and TAIGA_PASSWORD.`,
        response.status,
      );
    }
    return this.#remember((await response.json()) as RawAuth);
  }

  #remember(auth: RawAuth): string {
    this.#token = auth.auth_token;
    this.#refreshToken = auth.refresh;
    return auth.auth_token;
  }
}
