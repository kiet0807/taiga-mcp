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

/** One page of a long list, and how many items the list has in all. */
export interface Page<T> {
  readonly items: T[];
  readonly total: number;
}

const TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
/** `size` is what was seen so far, so it may be less than the whole file. */
const tooLarge = (size: number, max: number) =>
  `The file is at least ${megabytes(size)}; this server reads files up to ${megabytes(max)}. Open it in Taiga instead.`;

/** The two ways this server changes Taiga. There is deliberately no DELETE. */
export type WriteMethod = 'POST' | 'PATCH';

/**
 * The only place that talks to Taiga. It signs in on first use, keeps the tokens in memory,
 * and renews them once when Taiga answers 401. It sends GET requests, plus the two POSTs of the
 * sign-in itself; POST and PATCH to create and change items only when the configuration allows
 * writes. It has no way to send a DELETE.
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
    const response = await this.#request('GET', path, query, headers);
    return (await response.json()) as T;
  }

  /** Whether this connection may create and change items. */
  get writable(): boolean {
    return this.#config.write === true;
  }

  /** Create (POST) or change (PATCH) something, and read back what Taiga made of it. */
  async write<T>(method: WriteMethod, path: string, body: Readonly<Record<string, unknown>>): Promise<T> {
    // A second lock behind the tools: a read-only connection never sends a write, whatever calls it.
    if (!this.writable) {
      throw new TaigaError('This connection is read-only: changing Taiga is not switched on.', 403);
    }
    const response = await this.#request(method, path, {}, {}, body);
    return (await response.json()) as T;
  }

  /**
   * `limit` items of a list that may be long: the first ones, or those of a later `page`.
   * Taiga reports the full count in a header.
   */
  async page<T>(path: string, query: Query, limit: number, page = 1): Promise<Page<T>> {
    const paging = page > 1 ? { page_size: limit, page } : { page_size: limit };
    let response: Response;
    try {
      response = await this.#request('GET', path, { ...query, ...paging }, {});
    } catch (error) {
      // Taiga answers 404 for a page after the last one.
      if (page > 1 && error instanceof TaigaError && error.status === 404) {
        throw new TaigaError(
          `The list has no page ${page} at ${limit} items a page. Call again with \`page\`: 1 to see how many items there are.`,
          404,
        );
      }
      throw error;
    }
    const items = (await response.json()) as T[];
    const count = Number(response.headers.get('x-pagination-count') ?? Number.NaN);
    return { items, total: Number.isFinite(count) ? Math.max(count, items.length) : items.length };
  }

  /**
   * A file Taiga stores, by the address Taiga gave for it. Those addresses carry their own
   * signature, so no token is sent: the file server may be another host. Stops at `maxBytes`.
   */
  async download(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string | undefined }> {
    let response: Response;
    try {
      response = await this.#fetch(new URL(url), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaigaError(`Could not download the file (${reason}).`);
    }
    if (!response.ok) {
      throw new TaigaError(
        response.status === 403 || response.status === 401
          ? 'Taiga refused the file. Its link may have expired: read the item again with get_item and retry.'
          : `Taiga answered ${response.status} for the file.`,
        response.status,
      );
    }
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new TaigaError(tooLarge(declared, maxBytes), 413);
    }
    // The declared length may be missing or wrong: count while reading.
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    while (reader !== undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new TaigaError(tooLarge(size, maxBytes), 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { bytes, type: response.headers.get('content-type') ?? undefined };
  }

  /* ------------------------------ requests ------------------------------ */

  async #request(
    method: 'GET' | WriteMethod,
    path: string,
    query: Query,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    let response = await this.#send(
      path,
      query,
      { ...headers, ...this.#bearer(await this.#currentToken()) },
      body,
      method,
    );
    if (response.status === 401) {
      response = await this.#send(
        path,
        query,
        { ...headers, ...this.#bearer(await this.#renewToken()) },
        body,
        method,
      );
    }
    if (!response.ok) throw await this.#failure(response, path, method);
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
    /** GET without a body; the sign-in sends its body with POST. */
    method: 'GET' | WriteMethod = body === undefined ? 'GET' : 'POST',
  ): Promise<Response> {
    const url = new URL(`${this.#config.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      return await this.#fetch(url, {
        method,
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
      if (method !== 'GET' && !path.startsWith('/auth')) {
        // The request may have arrived even though no answer came back: do not invite a duplicate.
        throw new TaigaError(
          `No answer from Taiga at ${this.#config.baseUrl} (${reason}). The change may or may not have been made: ` +
            'look at the item (or the list) before trying again.',
        );
      }
      throw new TaigaError(`Could not reach Taiga at ${this.#config.baseUrl} (${reason}). Check TAIGA_URL.`);
    }
  }

  async #failure(response: Response, path: string, method: 'GET' | WriteMethod): Promise<TaigaError> {
    const { status } = response;
    const verb = method === 'GET' ? 'read' : 'change';
    if (status === 401) {
      return new TaigaError(
        'Taiga did not accept the sign-in. Check the credentials in the environment.',
        401,
      );
    }
    if (status === 403) return new TaigaError(`The signed-in user may not ${verb} ${path} in Taiga.`, 403);
    if (status === 404) return new TaigaError(`Taiga has nothing at ${path}.`, 404);
    if (status === 429)
      return new TaigaError('Taiga is rate-limiting requests. Wait a moment and try again.', 429);
    // Taiga explains most client errors in `_error_message`, and a rejected change field by field.
    const detail = await response
      .json()
      .then(explain)
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
        this.#config.expiredHint ??
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

/** Taiga's reason for refusing a request, in one line: its message, or each field and what is wrong. */
function explain(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  if ('_error_message' in data) return String(data._error_message);
  return Object.entries(data)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(' ') : String(value)}`)
    .join('; ');
}
