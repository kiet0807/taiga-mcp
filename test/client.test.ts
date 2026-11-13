import { describe, expect, it } from 'vitest';
import { TaigaClient, TaigaError } from '../src/taiga/client.js';
import { BASE, fakeTaiga, json, USER, type Call } from './fake-taiga.js';

const withPassword = { baseUrl: BASE, credentials: { username: 'kiet', password: 'hunter2' } };
const auth = (n: number) => json({ auth_token: `token-${n}`, refresh: `refresh-${n}` });
const bearer = (call: Call | undefined) => call?.headers['authorization'];

describe('TaigaClient sign-in', () => {
  it('signs in on first use and sends the token as a bearer', async () => {
    const taiga = fakeTaiga((call) => (call.path === '/auth' ? auth(1) : json(USER)));
    const user = await new TaigaClient(withPassword, taiga.fetch).currentUser();

    expect(user.username).toBe('kiet');
    expect(taiga.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth', 'GET /users/me']);
    expect(taiga.calls[0]?.body).toEqual({ type: 'normal', username: 'kiet', password: 'hunter2' });
    expect(bearer(taiga.calls[1])).toBe('Bearer token-1');
  });

  it('shares one sign-in between calls made at the same time', async () => {
    const taiga = fakeTaiga((call) => (call.path === '/auth' ? auth(1) : json([])));
    const client = new TaigaClient(withPassword, taiga.fetch);
    // Both start before either has a token, so both need the sign-in.
    await Promise.all([client.currentUser(), client.currentUser()]);
    expect(taiga.calls.filter((c) => c.path === '/auth')).toHaveLength(1);
  });

  it('renews an expired token with the refresh token and repeats the request once', async () => {
    const taiga = fakeTaiga((call) => {
      if (call.path === '/auth/refresh') return auth(2);
      return bearer(call) === 'Bearer token-2' ? json(USER) : json({}, 401);
    });
    const client = new TaigaClient({ baseUrl: BASE, token: 'stale', refreshToken: 'refresh-1' }, taiga.fetch);

    expect((await client.currentUser()).id).toBe(7);
    expect(taiga.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /users/me',
      'POST /auth/refresh',
      'GET /users/me',
    ]);
    expect(taiga.calls[1]?.body).toEqual({ refresh: 'refresh-1' });
  });

  it('signs in again when the refresh token is rejected too', async () => {
    const taiga = fakeTaiga((call) => {
      if (call.path === '/auth/refresh') return json({}, 401);
      if (call.path === '/auth') return auth(3);
      return bearer(call) === 'Bearer token-3' ? json(USER) : json({}, 401);
    });
    const client = new TaigaClient(
      { ...withPassword, token: 'stale', refreshToken: 'stale-refresh' },
      taiga.fetch,
    );
    expect((await client.currentUser()).id).toBe(7);
    expect(taiga.calls.map((c) => c.path)).toEqual(['/users/me', '/auth/refresh', '/auth', '/users/me']);
  });

  it('explains what to set when a token expires and there is no way to renew it', async () => {
    const taiga = fakeTaiga(() => json({}, 401));
    const client = new TaigaClient({ baseUrl: BASE, token: 'stale' }, taiga.fetch);
    await expect(client.currentUser()).rejects.toThrow(/TAIGA_TOKEN.*TAIGA_USERNAME/s);
  });

  it('reports a failed sign-in without repeating the password', async () => {
    const taiga = fakeTaiga(() => json({ _error_message: 'wrong password hunter2' }, 401));
    const error: unknown = await new TaigaClient(withPassword, taiga.fetch).currentUser().catch((e) => e);
    expect(error).toBeInstanceOf(TaigaError);
    expect(String(error)).toMatch(/sign-in failed \(401\)/);
    expect(String(error)).not.toContain('hunter2');
  });
});

describe('TaigaClient requests', () => {
  it('lists the projects the user is a member of, all pages at once, by name', async () => {
    const taiga = fakeTaiga((call) => {
      if (call.path === '/users/me') return json(USER);
      return json([
        { id: 2, name: 'Warehouse', slug: 'warehouse', is_private: true, description: 'long text' },
        { id: 1, name: 'Billing', slug: 'billing', is_private: false },
      ]);
    });
    const projects = await new TaigaClient({ baseUrl: BASE, token: 't' }, taiga.fetch).listProjects();

    expect(projects).toEqual([
      { id: 1, name: 'Billing', slug: 'billing', isPrivate: false },
      { id: 2, name: 'Warehouse', slug: 'warehouse', isPrivate: true },
    ]);
    const request = taiga.calls.find((c) => c.path === '/projects');
    expect(request?.query).toEqual({ member: '7' });
    expect(request?.headers['x-disable-pagination']).toBe('True');
  });

  it('turns HTTP errors into messages a person can act on', async () => {
    const answer = (status: number, body: unknown = {}) =>
      new TaigaClient({ baseUrl: BASE, token: 't' }, fakeTaiga(() => json(body, status)).fetch)
        .currentUser()
        .catch((e: unknown) => String(e));

    expect(await answer(403)).toMatch(/may not read \/users\/me/);
    expect(await answer(404)).toMatch(/nothing at \/users\/me/);
    expect(await answer(429)).toMatch(/rate-limiting/);
    expect(await answer(400, { _error_message: 'Bad filter' })).toMatch(/answered 400.*Bad filter/);
  });

  it('says so when Taiga cannot be reached', async () => {
    const offline: typeof fetch = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
    const client = new TaigaClient({ baseUrl: BASE, token: 't' }, offline);
    await expect(client.currentUser()).rejects.toThrow(/Could not reach Taiga at https:\/\/taiga\.example/);
  });
});
