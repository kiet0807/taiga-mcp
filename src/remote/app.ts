import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createServer } from '../server.js';
import { TaigaClient } from '../taiga/client.js';
import { TaigaError } from '../taiga/http.js';
import { guardedFetch } from './guard.js';
import { expiredPage, homePage, loginPage, type Lang, type LoginError } from './pages.js';
import { SCOPE, TaigaOAuthProvider } from './provider.js';
import { Sealer } from './seal.js';
import { TaigaAuth } from './taiga-auth.js';

export interface AppOptions {
  /**
   * The Taiga people sign in to. With `anyTaiga` it is only the suggestion that stands in the
   * address field of the sign-in page, and may be left out.
   */
  readonly taigaUrl?: string | undefined;
  /** Let each person type the address of their own Taiga. */
  readonly anyTaiga?: boolean;
  readonly publicUrl: URL;
  readonly secret: string;
  readonly trustProxy?: number;
  /** For tests: a stand-in for Taiga, and a clock. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const EXPIRED_HINT =
  'The Taiga sign-in behind this connection has expired. Disconnect the Taiga connector and connect it again to sign in.';

/** Vietnamese for a browser that prefers it over English; English for everyone else. */
function langOf(req: Request): Lang {
  for (const tag of req.acceptsLanguages()) {
    const language = tag.toLowerCase().split('-')[0];
    if (language === 'vi' || language === 'en') return language;
  }
  return 'en';
}

/** Pages with a password field: never cached, never framed, nothing loaded from elsewhere. */
function sendPage(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    .type('html')
    .send(html);
}

/**
 * The hosted server: the same six tools over HTTP, for many people at once.
 *
 * Each person signs in with their own Taiga account through the OAuth pages, and every request
 * to `/mcp` is answered with that person's Taiga token, so they see what Taiga lets them see.
 * The server is set up either for one Taiga, or (`anyTaiga`) for whichever Taiga each person names.
 * Nothing is kept between requests: no sessions, no stored tokens, no cache shared by two people.
 */
export function createApp(options: AppOptions): Express {
  const anyTaiga = options.anyTaiga === true;
  const fixedTaiga = anyTaiga ? undefined : options.taigaUrl;
  if (!anyTaiga && fixedTaiga === undefined) throw new Error('taigaUrl is required unless anyTaiga is set');
  const fixedHost = fixedTaiga === undefined ? undefined : new URL(fixedTaiga).host;
  // Requests to an address a stranger typed never leave the public internet.
  const fetchImpl = options.fetch ?? (anyTaiga ? guardedFetch : fetch);
  const now = options.now ?? (() => new Date());
  const seconds = () => Math.floor(now().getTime() / 1000);
  const mcpUrl = new URL('/mcp', options.publicUrl);

  const provider = new TaigaOAuthProvider({
    sealer: new Sealer(options.secret, seconds),
    taigaAt: (baseUrl) => new TaigaAuth(baseUrl, fetchImpl),
    fixedTaiga,
    resource: mcpUrl,
    now: seconds,
    showLogin: (res, view) =>
      sendPage(res, 200, loginPage({ lang: langOf(res.req), fixedHost, address: options.taigaUrl, ...view })),
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? 0);

  /* ------------------------------ signing in ------------------------------ */

  // /authorize, /token, /register and the two discovery documents.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: options.publicUrl,
      resourceServerUrl: mcpUrl,
      scopesSupported: [SCOPE],
      resourceName: fixedHost === undefined ? 'Taiga (read-only)' : `Taiga at ${fixedHost} (read-only)`,
    }),
  );

  const showLoginAgain = (req: Request, res: Response, status: number, error: LoginError) => {
    const { request, username, address } = req.body as Record<string, string | undefined> & {
      request: string;
    };
    const asker = provider.describeLogin(request);
    if (asker === undefined) {
      sendPage(res, 400, expiredPage(langOf(req)));
      return;
    }
    sendPage(
      res,
      status,
      loginPage({ lang: langOf(req), fixedHost, address, ...asker, request, error, username }),
    );
  };

  app.post(
    '/login',
    express.urlencoded({ extended: false, limit: '16kb' }),
    (req: Request, res: Response, next: NextFunction) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body['request'] !== 'string' || body['request'] === '') {
        sendPage(res, 400, expiredPage(langOf(req)));
        return;
      }
      next();
    },
    // Taiga throttles sign-ins too; this keeps a guesser from using the server as a relay.
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => showLoginAgain(req, res, 429, 'tooMany'),
    }),
    async (req: Request, res: Response) => {
      const { request, username, password, address } = req.body as Record<string, unknown>;
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        showLoginAgain(req, res, 400, 'rejected');
        return;
      }
      try {
        const outcome = await provider.completeLogin(
          request as string,
          username.trim(),
          password,
          typeof address === 'string' ? address : undefined,
        );
        if (outcome.kind === 'redirect') {
          res.set('Cache-Control', 'no-store').redirect(302, outcome.url);
        } else if (outcome.kind === 'rejected') {
          showLoginAgain(req, res, 401, 'rejected');
        } else if (outcome.kind === 'badAddress') {
          showLoginAgain(req, res, 400, 'badAddress');
        } else {
          sendPage(res, 400, expiredPage(langOf(req)));
        }
      } catch (error) {
        // The reason may name the Taiga host; it never contains the username or the password.
        console.error(`taiga-mcp: sign-in could not be checked: ${String(error)}`);
        // At a typed address, anything but "busy" or "broken" most likely means it is not a Taiga.
        const busy = error instanceof TaigaError && (error.status === 429 || (error.status ?? 0) >= 500);
        if (anyTaiga && !busy) showLoginAgain(req, res, 400, 'badAddress');
        else showLoginAgain(req, res, 502, 'unavailable');
      }
    },
  );

  /* ------------------------------- the tools ------------------------------- */

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    expectedResource: mcpUrl,
  });

  // Tokens travel in a header, never in a cookie, so any web page may call the endpoint.
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    });
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.post('/mcp', bearer, express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const { taigaUrl: baseUrl, taigaToken: token } = req.auth?.extra ?? {};
    if (typeof baseUrl !== 'string' || typeof token !== 'string') {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    // A server and a Taiga client per request: nothing one person reads is kept for the next.
    const server = createServer(
      new TaigaClient({ baseUrl, token, expiredHint: EXPIRED_HINT }, fetchImpl, now),
    );
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // No sessions and no server-sent stream: the endpoint only answers POST.
  app.all('/mcp', (_req: Request, res: Response) => {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null });
  });

  /* -------------------------------- the rest -------------------------------- */

  app.get('/', (req: Request, res: Response) => {
    sendPage(res, 200, homePage(langOf(req), fixedHost, mcpUrl.href));
  });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Express tells an error handler from a route by its four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500;
    if (status >= 500) console.error(`taiga-mcp: request failed: ${String(error)}`);
    if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'server_error' : 'bad_request' });
  });

  return app;
}
