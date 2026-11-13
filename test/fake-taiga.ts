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

/** A list the way Taiga pages it: `page_size` items, and the full count in a header. */
export function paged(items: readonly unknown[], call: Call): Response {
  const size = Number(call.query['page_size'] ?? 30);
  return json(items.slice(0, size), 200, { 'x-pagination-count': String(items.length) });
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
