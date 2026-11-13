/** A stand-in for Taiga's HTTP API: records every request and answers from a handler. No network. */
export interface Call {
  readonly method: string;
  /** Path below /api/v1, e.g. "/projects". */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * A list the way Taiga pages it: `page_size` items of the asked `page`, the full count in a
 * header, and 404 for a page after the last one.
 */
export function paged(items: readonly unknown[], call: Call): Response {
  const size = Number(call.query['page_size'] ?? 30);
  const page = Number(call.query['page'] ?? 1);
  const start = (page - 1) * size;
  if (page > 1 && start >= items.length) {
    return json({ _error_message: "Page is not 'last', nor can it be converted to an int." }, 404);
  }
  return json(items.slice(start, start + size), 200, { 'x-pagination-count': String(items.length) });
}

export function fakeTaiga(handler: (call: Call, calls: readonly Call[]) => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/api\/v1/, ''),
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return handler(call, calls);
  };
  return { fetch: fetchImpl, calls };
}

export const BASE = 'https://taiga.example';
export const USER = { id: 7, username: 'kiet', full_name: 'Kiet' };
