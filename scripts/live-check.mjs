// Checks the hosted server from outside, without any account: what someone connecting for the
// first time goes through. .github/workflows/live.yml runs it once a day.
//
//   node scripts/live-check.mjs [https://taiga.kaidev.io.vn]
//
// It makes one sign-in attempt, with a made-up account at Taiga cloud. Taiga refusing it proves
// the server can reach Taiga. The server allows 10 attempts per 15 minutes from one address.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'https://taiga.kaidev.io.vn').replace(/\/+$/, '');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const redirect = 'http://localhost:53999/callback';

const failed = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${detail})`}`);
  if (!ok) failed.push(name);
};
const call = (path, init = {}) =>
  fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
const jsonOf = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const health = await call('/healthz');
check('the server answers', health.status === 200, `status ${health.status}`);

const front = await call('/');
const page = await front.text();
check(
  `the front page shows version ${version}`,
  front.status === 200 && page.includes(`taiga-mcp ${version}`),
);

const issuer = await jsonOf(await call('/.well-known/oauth-authorization-server'));
check('apps find where to sign in', issuer.issuer === `${base}/`, issuer.issuer);
const resource = await jsonOf(await call('/.well-known/oauth-protected-resource/mcp'));
check('apps find what the tokens are for', resource.resource === `${base}/mcp`, resource.resource);

const registered = await call('/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'live-check',
    redirect_uris: [redirect],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
});
const client = await jsonOf(registered);
check(
  'an app can register',
  registered.status === 201 && typeof client.client_id === 'string',
  `status ${registered.status}`,
);

const verifier = randomBytes(32).toString('base64url');
const query = new URLSearchParams({
  response_type: 'code',
  client_id: client.client_id ?? '',
  redirect_uri: redirect,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  code_challenge_method: 'S256',
  state: 'live-check',
  scope: 'read',
  resource: `${base}/mcp`,
});
const authorize = await call(`/authorize?${query}`);
const request = /name="request" value="([^"]+)"/.exec(await authorize.text())?.[1];
check(
  'the sign-in page opens',
  authorize.status === 200 && request !== undefined,
  `status ${authorize.status}`,
);

if (request !== undefined) {
  const login = await call('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      request,
      username: `no-such-user-${randomBytes(6).toString('hex')}`,
      password: randomBytes(12).toString('hex'),
      address: 'https://tree.taiga.io',
    }),
  });
  // 401: Taiga cloud answered "wrong password". 502: the server could not reach it.
  check(
    'the server reaches Taiga cloud, which refuses a made-up account',
    login.status === 401,
    `status ${login.status}`,
  );
}

const mcp = await call('/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer made-up',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
check('a made-up token is refused', mcp.status === 401, `status ${mcp.status}`);

if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed at ${base}. The server's log on Vercel says why.`);
  process.exit(1);
}
console.log(`\nAll checks passed at ${base}.`);
