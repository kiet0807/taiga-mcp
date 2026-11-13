import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { createApp } from '../src/remote/app.js';
import { loadRemoteConfig } from '../src/remote/config.js';
import { guardedFetch, isPublicAddress, taigaAddress } from '../src/remote/guard.js';
import { Sealer } from '../src/remote/seal.js';
import { acme } from './acme.js';
import { BASE, json, type Call } from './fake-taiga.js';

const SECRET = 'a-secret-for-tests-that-is-long-enough-0123456789';
const REDIRECT = 'https://app.example/callback';
const HOUR = 3600;
/** The SDK checks a token's expiry against the real clock, so the test clock starts at the real time. */
const START = new Date(Math.floor(Date.now() / 1000) * 1000);

/** A token shaped like Taiga's: a JWT whose payload says when it expires. */
const jwt = (name: string, expiresAt: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expiresAt, name })).toString('base64url')}.s`;

/** The people who have an account on the fake Taiga, by username. */
const PASSWORDS: Record<string, string> = { kiet: 'correct horse', linh: 'battery staple' };

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/**
 * The hosted server on a free local port, in front of the fake Taiga. By default it is set up
 * for the one Taiga at `BASE`; `anyTaiga` lets each person type an address instead.
 */
async function start(setup: { anyTaiga?: boolean; taigaUrl?: string | undefined } = { taigaUrl: BASE }) {
  const clock = { now: START };
  const seconds = () => Math.floor(clock.now.getTime() / 1000);
  let issued = 0;
  const pair = (username: string) => {
    issued += 1;
    return {
      auth_token: jwt(`${username}-access-${issued}`, seconds() + 24 * HOUR),
      refresh: jwt(`${username}-refresh-${issued}`, seconds() + 8 * 24 * HOUR),
    };
  };
  /** The host of every request sent to Taiga, in order. */
  const hosts: string[] = [];
  /** Refresh tokens Taiga still accepts, and whose they are. */
  const refreshable = new Map<string, string>();
  const signedIn = (username: string) => {
    const tokens = pair(username);
    refreshable.set(tokens.refresh, username);
    return tokens;
  };

  const taiga = acme((call: Call) => {
    // One host in the tests is a website that is not a Taiga.
    if (hosts.at(-1) === 'not-taiga.example.org') return new Response('<html>Hello</html>', { status: 404 });
    if (call.path === '/auth') {
      const { username, password } = call.body as { username: string; password: string };
      return PASSWORDS[username] === password
        ? json({ id: 7, username, ...signedIn(username) })
        : json({ _error_message: 'No active account found' }, 401);
    }
    if (call.path === '/auth/refresh') {
      const { refresh } = call.body as { refresh: string };
      const username = refreshable.get(refresh);
      if (username === undefined) return json({ _error_message: 'Token is invalid' }, 401);
      refreshable.delete(refresh);
      return json(signedIn(username));
    }
    return undefined;
  });

  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  server.on(
    'request',
    createApp({
      ...setup,
      publicUrl: new URL(base),
      secret: SECRET,
      fetch: (input, init) => {
        hosts.push(new URL(input instanceof Request ? input.url : input).host);
        return taiga.fetch(input, init);
      },
      now: () => clock.now,
    }),
  );
  return { base, clock, calls: taiga.calls, hosts };
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
  redirect: 'manual' as const,
});

async function register(base: string): Promise<string> {
  const response = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: 'Test App',
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Open the sign-in page the way an app sends a person to it. */
async function openLogin(base: string, clientId: string) {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: `${base}/mcp`,
  });
  const response = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  const html = await response.text();
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return { response, html, request, verifier };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** The whole way from registering an app to holding tokens for one person. */
async function connectAs(base: string, username: string, address?: string) {
  const clientId = await register(base);
  const { request, verifier } = await openLogin(base, clientId);
  const login = await fetch(
    `${base}/login`,
    form({
      request,
      username,
      password: PASSWORDS[username] ?? '',
      ...(address === undefined ? {} : { address }),
    }),
  );
  expect(login.status).toBe(302);
  const callback = new URL(login.headers.get('location') ?? '');
  const code = callback.searchParams.get('code') ?? '';
  const exchange = () =>
    fetch(
      `${base}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: REDIRECT,
      }),
    );
  const response = await exchange();
  expect(response.status).toBe(200);
  return { clientId, callback, code, verifier, exchange, tokens: (await response.json()) as Tokens };
}

/** An MCP client talking to the hosted endpoint with a bearer token. */
async function mcp(base: string, accessToken: string) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

const post = (base: string, token?: string) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { text: string }[]).map((part) => part.text).join('\n');

describe('sealed values', () => {
  const sealer = new Sealer(SECRET, () => 1000);

  it('open again with what was sealed', () => {
    const sealed = sealer.seal('code', { a: 1 }, 1060);
    expect(sealer.open('code', sealed)).toEqual({ data: { a: 1 }, expiresAt: 1060 });
    expect(sealed).not.toContain('"a"');
  });

  it('do not open for another purpose, after a change, with another secret, or once expired', () => {
    const sealed = sealer.seal('access', { token: 't' }, 1060);
    expect(sealer.open('refresh', sealed)).toBeUndefined();
    const changed = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(sealer.open('access', changed)).toBeUndefined();
    expect(new Sealer(`${SECRET}x`, () => 1000).open('access', sealed)).toBeUndefined();
    expect(new Sealer(SECRET, () => 1060).open('access', sealed)).toBeUndefined();
    expect(sealer.open('access', 'not sealed at all')).toBeUndefined();
  });
});

describe('the hosted server', () => {
  it('tells apps where to sign in', async () => {
    const { base } = await start();

    const refused = await post(base);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${base}/mcp`);
    expect(resource.authorization_servers).toEqual([`${base}/`]);

    const metadata = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('shows a sign-in page that names the app and the Taiga host', async () => {
    const { base } = await start();
    const { response, html } = await openLogin(base, await register(base));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(html).toContain('Test App is asking to read your Taiga projects at taiga.example.');
    // The name is whatever the app called itself; where the person ends up is not.
    expect(html).toContain('After signing in you are sent back to app.example.');
    expect(html).toContain('type="password"');
  });

  it('signs a person in and answers the tools with their own Taiga token', async () => {
    const { base, calls } = await start();
    const { callback, tokens } = await connectAs(base, 'kiet');

    expect(callback.origin + callback.pathname).toBe(REDIRECT);
    expect(callback.searchParams.get('state')).toBe('state-123');
    expect(tokens.scope).toBe('read');
    // A little less than the 24 hours the Taiga token lasts.
    expect(tokens.expires_in).toBe(24 * HOUR - 60);

    const client = await mcp(base, tokens.access_token);
    const result = await client.callTool({ name: 'list_sprints', arguments: { project: 'acme-billing' } });
    expect(textOf(result)).toContain('Acme Billing · open sprints: 2 sprints.');

    // The password went to Taiga's sign-in and nowhere else; the tools used the token Taiga gave.
    const withPassword = calls.filter((call) => JSON.stringify(call.body ?? '').includes('correct horse'));
    expect(withPassword.map((call) => call.path)).toEqual(['/auth']);
    const reads = calls.filter((call) => call.method === 'GET');
    expect(reads.length).toBeGreaterThan(0);
    for (const call of reads) {
      expect(call.headers['authorization']).toBe(
        `Bearer ${jwt('kiet-access-1', START.getTime() / 1000 + 24 * HOUR)}`,
      );
    }
    // Neither token shows what is inside it.
    expect(tokens.access_token).not.toContain('kiet');
    expect(Buffer.from(tokens.access_token, 'base64url').toString('latin1')).not.toContain('kiet');
  });

  it('keeps two people apart', async () => {
    const { base, calls } = await start();
    const kiet = await mcp(base, (await connectAs(base, 'kiet')).tokens.access_token);
    const linh = await mcp(base, (await connectAs(base, 'linh')).tokens.access_token);

    const used = async (client: Client) => {
      const before = calls.length;
      await client.callTool({ name: 'list_projects', arguments: {} });
      const tokens = calls.slice(before).map((call) => call.headers['authorization'] ?? '');
      return new Set(
        tokens.map(
          (header) => JSON.parse(Buffer.from(header.split('.')[1] ?? '', 'base64url').toString()).name,
        ),
      );
    };
    expect(await used(kiet)).toEqual(new Set(['kiet-access-1']));
    expect(await used(linh)).toEqual(new Set(['linh-access-2']));
    expect(await used(kiet)).toEqual(new Set(['kiet-access-1']));
  });

  it('shows the form again after a wrong password, without sending the app anything', async () => {
    const { base } = await start();
    const { request } = await openLogin(base, await register(base));

    const response = await fetch(`${base}/login`, form({ request, username: 'kiet', password: 'wrong one' }));
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(html).toContain('Taiga did not accept that username and password.');
    expect(html).toContain('Test App is asking to read your Taiga projects');
    expect(html).toContain('After signing in you are sent back to app.example.');
    expect(html).toContain('value="kiet"');
    expect(html).not.toContain('wrong one');
    expect(html).toContain(`value="${request}"`);
  });

  it('answers in Vietnamese to a browser that asks for it', async () => {
    const { base } = await start();
    const home = await fetch(base, { headers: { 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.5' } });
    const html = await home.text();
    expect(html).toContain('Taiga cho trợ lý AI');
    expect(html).toContain(`<code>${base}/mcp</code>`);
  });

  it('lets the front page be found, with a description and a preview image', async () => {
    const { base } = await start();
    const home = await fetch(base, { headers: { 'Accept-Language': 'en' } });
    const html = await home.text();

    expect(home.headers.get('vary')).toContain('Accept-Language');
    expect(home.headers.get('content-security-policy')).toContain("img-src 'self'");
    expect(html).toContain('<meta name="robots" content="index, follow">');
    expect(html).toContain('<title>Taiga for AI assistants: ask Claude about your projects</title>');
    expect(html).toMatch(/<meta name="description" content="Connect Claude or any MCP app to Taiga[^"]+">/);
    expect(html).toContain(`<link rel="canonical" href="${base}/">`);
    expect(html).toContain(`<link rel="alternate" hreflang="vi" href="${base}/?lang=vi">`);
    expect(html).toContain(`<meta property="og:image" content="${base}/og.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  });

  it('answers in the language a link names, whatever the browser prefers', async () => {
    const { base } = await start();
    const home = await fetch(`${base}/?lang=vi`, { headers: { 'Accept-Language': 'en-US' } });
    const html = await home.text();
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain('Bạn có thể hỏi gì');
    expect(html).toContain(`<link rel="canonical" href="${base}/?lang=vi">`);
    expect(html).toContain('<meta property="og:locale" content="vi_VN">');

    const unknown = await (await fetch(`${base}/?lang=fr`, { headers: { 'Accept-Language': 'en' } })).text();
    expect(unknown).toContain('<html lang="en">');
    expect(unknown).toContain(`<link rel="canonical" href="${base}/">`);
  });

  it('explains how to connect from other AI apps, with this server’s address filled in', async () => {
    const { base } = await start();
    const html = await (await fetch(base, { headers: { 'Accept-Language': 'en' } })).text();
    for (const app of [
      'Claude Code',
      'ChatGPT',
      'VS Code (GitHub Copilot)',
      'Cursor',
      'Gemini CLI',
      'Codex CLI',
      'Windsurf',
    ]) {
      expect(html, app).toContain(`<summary>${app}</summary>`);
    }
    expect(html).toContain(`claude mcp add --transport http taiga ${base}/mcp`);
    // The configuration is JSON as the app reads it, with quotes escaped for HTML.
    expect(html).toContain(`&quot;httpUrl&quot;: &quot;${base}/mcp&quot;`);
    expect(html).not.toMatch(/<script/i);
  });

  it('keeps the sign-in page out of search and link previews', async () => {
    const { base } = await start();
    const { html } = await openLogin(base, await register(base));
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('rel="canonical"');
  });

  it('serves its icons, the preview image and robots.txt', async () => {
    const { base } = await start();
    const types: Record<string, RegExp> = {
      '/favicon.svg': /^image\/svg\+xml/,
      // Both names are in use for the same format.
      '/favicon.ico': /^image\/(x-icon|vnd\.microsoft\.icon)/,
      '/apple-touch-icon.png': /^image\/png/,
      '/og.png': /^image\/png/,
    };
    for (const [path, type] of Object.entries(types)) {
      const file = await fetch(`${base}${path}`);
      expect(file.status, path).toBe(200);
      expect(file.headers.get('content-type'), path).toMatch(type);
    }
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    expect(robots).toContain('Allow: /$');
    expect(robots).toContain('Disallow: /');
    // A folder is not a page, and nothing outside `public` is served.
    expect((await fetch(`${base}/public/favicon.svg`)).status).toBe(404);
    expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
  });

  it('refuses a sign-in form whose hidden field was changed or left open too long', async () => {
    const { base, clock, calls } = await start();
    const { request } = await openLogin(base, await register(base));
    const send = (value: string) =>
      fetch(`${base}/login`, form({ request: value, username: 'kiet', password: 'correct horse' }));

    expect((await send(`${request.slice(0, -4)}AAAA`)).status).toBe(400);
    clock.now = new Date(START.getTime() + 16 * 60 * 1000);
    const late = await send(request);
    expect(late.status).toBe(400);
    expect(await late.text()).toContain('This sign-in page has expired');
    // Taiga was never asked.
    expect(calls).toEqual([]);
  });

  it('accepts a code once, and only with the right verifier', async () => {
    const { base } = await start();
    const first = await connectAs(base, 'kiet');

    const again = await first.exchange();
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' });

    const clientId = await register(base);
    const { request } = await openLogin(base, clientId);
    const login = await fetch(
      `${base}/login`,
      form({ request, username: 'kiet', password: 'correct horse' }),
    );
    const code = new URL(login.headers.get('location') ?? '').searchParams.get('code') ?? '';
    const stolen = await fetch(
      `${base}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: randomBytes(32).toString('base64url'),
        client_id: clientId,
      }),
    );
    expect(stolen.status).toBe(400);
    expect(await stolen.json()).toMatchObject({ error: 'invalid_grant' });

    // A code belongs to the app that asked for it.
    const other = await fetch(
      `${base}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'x',
        client_id: await register(base),
      }),
    );
    expect(await other.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses tokens it did not issue, and a refresh token used as an access token', async () => {
    const { base } = await start();
    const { tokens } = await connectAs(base, 'kiet');

    expect((await post(base, tokens.access_token)).status).toBe(200);
    expect((await post(base, 'made-up-token')).status).toBe(401);
    expect((await post(base, tokens.refresh_token)).status).toBe(401);
    expect((await post(base, `${tokens.access_token.slice(0, -4)}AAAA`)).status).toBe(401);
  });

  it('stops accepting an access token when the Taiga token inside it runs out', async () => {
    const { base, clock } = await start();
    const { tokens } = await connectAs(base, 'kiet');

    clock.now = new Date(START.getTime() + (24 * HOUR - 61) * 1000);
    expect((await post(base, tokens.access_token)).status).toBe(200);
    clock.now = new Date(START.getTime() + (24 * HOUR - 59) * 1000);
    expect((await post(base, tokens.access_token)).status).toBe(401);
  });

  it('renews tokens through Taiga, once per refresh token', async () => {
    const { base, calls } = await start();
    const { clientId, tokens } = await connectAs(base, 'kiet');
    const renew = () =>
      fetch(
        `${base}/token`,
        form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
      );

    const response = await renew();
    expect(response.status).toBe(200);
    const renewed = (await response.json()) as Tokens;
    expect(renewed.access_token).not.toBe(tokens.access_token);
    expect(calls.filter((call) => call.path === '/auth/refresh')).toHaveLength(1);

    const client = await mcp(base, renewed.access_token);
    await client.callTool({ name: 'list_projects', arguments: {} });
    expect(calls.at(-1)?.headers['authorization']).toContain(
      Buffer.from(
        JSON.stringify({ exp: START.getTime() / 1000 + 24 * HOUR, name: 'kiet-access-2' }),
      ).toString('base64url'),
    );

    // Taiga gives each refresh token one use.
    const second = await renew();
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('slows down someone guessing passwords', async () => {
    const { base } = await start();
    const { request } = await openLogin(base, await register(base));
    const guess = () => fetch(`${base}/login`, form({ request, username: 'kiet', password: 'guess' }));

    for (let attempt = 0; attempt < 10; attempt += 1) expect((await guess()).status).toBe(401);
    const blocked = await guess();
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain('Too many attempts');
  });

  it('only answers POST on the MCP endpoint', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/mcp`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('a server for any Taiga', () => {
  it('asks for the address of the Taiga, suggesting one when it was given', async () => {
    const blank = await start({ anyTaiga: true });
    const first = await openLogin(blank.base, await register(blank.base));
    expect(first.html).toContain('Test App is asking to read your Taiga projects. It can only read');
    expect(first.html).toMatch(/<input name="address"[^>]* autofocus value="">/);

    const suggesting = await start({ anyTaiga: true, taigaUrl: 'https://taiga.acme-corp.com' });
    const second = await openLogin(suggesting.base, await register(suggesting.base));
    expect(second.html).toMatch(/<input name="address"[^>]* value="https:\/\/taiga.acme-corp.com">/);
    expect(second.html).toMatch(/<input name="username"[^>]* autofocus/);

    const home = await (await fetch(suggesting.base)).text();
    expect(home).toContain('on Taiga cloud or on your company’s own Taiga');
    expect(home).not.toContain('acme-corp');
  });

  it('signs in at the address the person typed, and stays with it', async () => {
    const { base, hosts } = await start({ anyTaiga: true });
    // Pasted from the address bar: no scheme, a path after the host.
    const { clientId, tokens } = await connectAs(base, 'kiet', 'Taiga.Acme-Corp.com/project/billing/backlog');

    const client = await mcp(base, tokens.access_token);
    const result = await client.callTool({ name: 'list_sprints', arguments: { project: 'acme-billing' } });
    expect(result.isError, textOf(result)).toBeFalsy();
    await fetch(
      `${base}/token`,
      form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
    );

    expect(hosts.length).toBeGreaterThan(3);
    expect(new Set(hosts)).toEqual(new Set(['taiga.acme-corp.com']));
  });

  it('sends Taiga cloud to its API host', async () => {
    const { base, hosts } = await start({ anyTaiga: true });
    await connectAs(base, 'kiet', 'https://tree.taiga.io/');
    expect(hosts).toEqual(['api.taiga.io']);
  });

  it.each([
    'localhost',
    'http://localhost:9000',
    '10.0.0.5',
    'https://[::1]/',
    '169.254.169.254',
    'ftp://files.example.com',
    'https://user:pw@taiga.example.com',
    'intranet',
    '',
  ])('never calls %o', async (address) => {
    const { base, hosts } = await start({ anyTaiga: true });
    const { request } = await openLogin(base, await register(base));
    const response = await fetch(
      `${base}/login`,
      form({ request, username: 'kiet', password: 'correct horse', address }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('No Taiga could be reached at that address.');
    expect(hosts).toEqual([]);
  });

  it('says so when the address is a website that is not a Taiga', async () => {
    const { base } = await start({ anyTaiga: true });
    const { request } = await openLogin(base, await register(base));
    const response = await fetch(
      `${base}/login`,
      form({ request, username: 'kiet', password: 'correct horse', address: 'not-taiga.example.org' }),
    );
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain('No Taiga could be reached at that address.');
    // What was typed is still in the form; the password is not.
    expect(html).toContain('value="not-taiga.example.org"');
    expect(html).toContain('value="kiet"');
    expect(html).not.toContain('correct horse');
  });
});

describe('a server for one Taiga', () => {
  it('ignores an address slipped into the sign-in form', async () => {
    const { base, hosts } = await start();
    await connectAs(base, 'kiet', 'https://evil.example.org');
    expect(hosts).toEqual(['taiga.example']);
  });

  it('refuses tokens that were issued for another Taiga', async () => {
    const open = await start({ anyTaiga: true });
    const { clientId, tokens } = await connectAs(open.base, 'kiet', 'taiga.acme-corp.com');
    // Same secret, but this server is for the Taiga at BASE only.
    const fixed = await start();

    expect((await post(open.base, tokens.access_token)).status).toBe(200);
    expect((await post(fixed.base, tokens.access_token)).status).toBe(401);
    const renewal = await fetch(
      `${fixed.base}/token`,
      form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
    );
    expect(renewal.status).toBe(400);
    expect(fixed.hosts).toEqual([]);
  });
});

describe('the guard on typed addresses', () => {
  it.each([
    ['taiga.acme-corp.com', 'https://taiga.acme-corp.com'],
    ['  https://Taiga.Acme-Corp.com/project/x?y=1  ', 'https://taiga.acme-corp.com'],
    ['http://taiga.acme-corp.com', 'https://taiga.acme-corp.com'],
    ['https://taiga.acme-corp.com:8443/api/v1', 'https://taiga.acme-corp.com:8443'],
    ['tree.taiga.io', 'https://api.taiga.io'],
    ['https://taiga.io/login', 'https://api.taiga.io'],
  ])('reads %o as %o', (typed, expected) => {
    expect(taigaAddress(typed)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'localhost',
    'taiga',
    '127.0.0.1',
    '[::1]',
    'https://192.168.1.10',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://a:b@taiga.example.com',
    'taiga .example.com',
    `${'a'.repeat(300)}.com`,
  ])('does not read %o as an address', (typed) => {
    expect(taigaAddress(typed)).toBeUndefined();
  });

  it('tells public addresses from the rest', () => {
    for (const address of ['8.8.8.8', '104.26.10.5', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      'not an address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('does not connect to this machine, by number or by name', async () => {
    let requests = 0;
    const local = createServer((_req, res) => {
      requests += 1;
      res.end('secret');
    });
    servers.push(local);
    await new Promise<void>((done) => local.listen(0, '127.0.0.1', done));
    const { port } = local.address() as AddressInfo;

    // The plain fetch reaches it; the guarded one does not.
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('secret');
    requests = 0;
    for (const host of ['127.0.0.1', 'localhost', '[::ffff:127.0.0.1]', '0.0.0.0']) {
      await expect(guardedFetch(`http://${host}:${port}/`), host).rejects.toThrow();
    }
    expect(requests).toBe(0);
  });
});

describe('the hosted configuration', () => {
  it('lets each person name their Taiga when asked to', () => {
    expect(
      loadRemoteConfig({ PUBLIC_URL: 'https://mcp.example', MCP_SECRET: SECRET, ANY_TAIGA: 'true' }),
    ).toMatchObject({
      taigaUrl: undefined,
      anyTaiga: true,
    });
  });

  const env = {
    TAIGA_URL: 'https://taiga.example/api/v1/',
    PUBLIC_URL: 'https://mcp.example',
    MCP_SECRET: SECRET,
  };

  it('reads the addresses, the secret and the defaults', () => {
    expect(loadRemoteConfig(env)).toEqual({
      taigaUrl: 'https://taiga.example',
      anyTaiga: false,
      publicUrl: new URL('https://mcp.example'),
      secret: SECRET,
      port: 3000,
      trustProxy: 1,
    });
    expect(loadRemoteConfig({ ...env, PUBLIC_URL: 'http://localhost:8080', PORT: '8080' })).toMatchObject({
      port: 8080,
      trustProxy: 0,
    });
  });

  it.each([
    [{ ...env, PUBLIC_URL: undefined }, 'PUBLIC_URL is not set'],
    [{ ...env, PUBLIC_URL: 'http://mcp.example' }, 'must start with https://'],
    [{ ...env, PUBLIC_URL: 'https://mcp.example/mcp' }, 'without a path'],
    [{ ...env, MCP_SECRET: 'short' }, 'at least 32 characters'],
    [{ ...env, MCP_SECRET: undefined }, 'at least 32 characters'],
    [{ ...env, TAIGA_URL: undefined }, 'TAIGA_URL is not set'],
    [{ ...env, ANY_TAIGA: 'maybe' }, 'ANY_TAIGA must be true or false'],
    [{ ...env, PORT: 'abc' }, 'PORT must be a whole number'],
  ])('says what is wrong with %o', (bad, message) => {
    expect(() => loadRemoteConfig(bad)).toThrow(ConfigError);
    expect(() => loadRemoteConfig(bad)).toThrow(message);
  });
});
