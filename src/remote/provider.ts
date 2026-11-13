import { createHash, randomUUID } from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import { taigaAddress } from './guard.js';
import type { Sealer } from './seal.js';
import { tokenExpiry, type TaigaAuth, type TaigaTokens } from './taiga-auth.js';

/** The one thing a token allows: reading. */
export const SCOPE = 'read';

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;
/** How long someone may take to type their password. */
const LOGIN_SECONDS = 15 * MINUTE;
/** How long the app has to trade the code for tokens. */
const CODE_SECONDS = 2 * MINUTE;
/** Tokens stop a little before the Taiga token inside them does. */
const MARGIN_SECONDS = MINUTE;
/** For Taiga tokens that do not carry an expiry. */
const FALLBACK_ACCESS_SECONDS = 7 * DAY;
const FALLBACK_REFRESH_SECONDS = 7 * DAY;

/** The registration fields worth remembering. They are sealed into the client id itself. */
type ClientRecord = Pick<
  OAuthClientInformationFull,
  | 'redirect_uris'
  | 'client_name'
  | 'token_endpoint_auth_method'
  | 'grant_types'
  | 'response_types'
  | 'scope'
  | 'client_secret'
  | 'client_secret_expires_at'
  | 'client_id_issued_at'
>;

/** An authorization request waiting for the person to sign in. */
interface PendingLogin {
  /** Fingerprint of the client id. */
  readonly cid: string;
  /** The app's name, as it registered itself. */
  readonly app: string | undefined;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string | undefined;
}

interface Code {
  readonly id: string;
  readonly cid: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  /** The Taiga the person signed in to, and the tokens it gave. */
  readonly url: string;
  readonly token: string;
  readonly refresh: string | undefined;
}

interface Access {
  readonly cid: string;
  readonly url: string;
  readonly token: string;
}

interface Refresh {
  readonly cid: string;
  readonly url: string;
  readonly refresh: string;
}

export type LoginOutcome =
  /** Send the browser here: the app receives its code. */
  | { readonly kind: 'redirect'; readonly url: string }
  /** Taiga did not accept the username and password: show the form again. */
  | { readonly kind: 'rejected' }
  /** What was typed as the Taiga address cannot be one. */
  | { readonly kind: 'badAddress' }
  /** The sign-in page was open too long, or its hidden field was changed. */
  | { readonly kind: 'expired' };

/** Who is asking for access, as far as the server can tell. Shown on the sign-in page. */
export interface LoginAsker {
  /** The app's name, as it registered itself. Anyone can register any name. */
  readonly app: string | undefined;
  /** Host the person is sent back to after signing in. This part cannot be made up. */
  readonly returnsTo: string;
}

export interface ProviderOptions {
  readonly sealer: Sealer;
  /** Sign-in and renewal at the Taiga with this address. */
  readonly taigaAt: (baseUrl: string) => TaigaAuth;
  /** The one Taiga people sign in to. Without it, each person types the address of theirs. */
  readonly fixedTaiga: string | undefined;
  /** The address of the MCP endpoint: the resource tokens are issued for. */
  readonly resource: URL;
  /** Seconds since the epoch. */
  readonly now?: () => number;
  /** Writes the sign-in page. `request` goes back unchanged in the form. */
  readonly showLogin: (res: Response, view: { request: string } & LoginAsker) => void;
}

/** A short stand-in for a client id, which can be several hundred characters long. */
const fingerprint = (clientId: string) =>
  createHash('sha256').update(clientId).digest('base64url').slice(0, 22);

const asker = (pending: PendingLogin): LoginAsker => ({
  app: pending.app,
  returnsTo: new URL(pending.redirectUri).host,
});

/**
 * An OAuth server in front of Taiga's own sign-in, for apps that connect to the hosted server.
 *
 * Taiga has no OAuth of its own, so the person types their Taiga username and password into
 * this server's sign-in page. The password is passed on to Taiga once and never kept; the
 * Taiga tokens that come back are sealed into the tokens given to the app. Nothing is stored
 * on the server.
 */
export class TaigaOAuthProvider implements OAuthServerProvider {
  readonly #sealer: Sealer;
  readonly #taigaAt: ProviderOptions['taigaAt'];
  readonly #fixedTaiga: string | undefined;
  readonly #resource: URL;
  readonly #now: () => number;
  readonly #showLogin: ProviderOptions['showLogin'];
  /** Codes already traded, until they expire. Kept in memory: a best effort on top of PKCE. */
  readonly #usedCodes = new Map<string, number>();

  constructor(options: ProviderOptions) {
    this.#sealer = options.sealer;
    this.#taigaAt = options.taigaAt;
    this.#fixedTaiga = options.fixedTaiga;
    this.#resource = options.resource;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#showLogin = options.showLogin;
  }

  /** Clients register themselves; the registration lives inside the client id they get back. */
  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => {
        const record = this.#sealer.open<ClientRecord>('client', clientId)?.data;
        return record === undefined ? undefined : { ...record, client_id: clientId };
      },
      registerClient: (client) => {
        const record: ClientRecord = {
          redirect_uris: client.redirect_uris,
          client_name: client.client_name?.slice(0, 80),
          token_endpoint_auth_method: client.token_endpoint_auth_method,
          grant_types: client.grant_types,
          response_types: client.response_types,
          scope: client.scope,
          client_secret: client.client_secret,
          client_secret_expires_at: client.client_secret_expires_at,
          client_id_issued_at: this.#now(),
        };
        return { ...client, ...record, client_id: this.#sealer.seal('client', record) };
      },
    };
  }

  /** Step 1: the app sends the person here. Show the sign-in page. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource !== undefined && params.resource.origin !== this.#resource.origin) {
      throw new InvalidTargetError('This server only issues tokens for itself.');
    }
    const pending: PendingLogin = {
      cid: fingerprint(client.client_id),
      app: client.client_name,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
    };
    this.#showLogin(res, {
      request: this.#sealer.seal('login', pending, this.#now() + LOGIN_SECONDS),
      ...asker(pending),
    });
  }

  /** Who a sign-in form is for, read back from its hidden field, to show the form again. */
  describeLogin(request: string): LoginAsker | undefined {
    const pending = this.#sealer.open<PendingLogin>('login', request)?.data;
    return pending === undefined ? undefined : asker(pending);
  }

  /** Step 2: the sign-in form was sent. Ask Taiga, and send the app its code. */
  async completeLogin(
    request: string,
    username: string,
    password: string,
    /** What the person typed as the address of their Taiga, when there is no fixed one. */
    address?: string,
  ): Promise<LoginOutcome> {
    const pending = this.#sealer.open<PendingLogin>('login', request)?.data;
    if (pending === undefined) return { kind: 'expired' };

    const taigaUrl = this.#fixedTaiga ?? taigaAddress(address ?? '');
    if (taigaUrl === undefined) return { kind: 'badAddress' };

    const tokens = await this.#taigaAt(taigaUrl).signIn(username, password);
    if (tokens === undefined) return { kind: 'rejected' };

    const code: Code = {
      id: randomUUID(),
      cid: pending.cid,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      url: taigaUrl,
      token: tokens.token,
      refresh: tokens.refresh,
    };
    const url = new URL(pending.redirectUri);
    url.searchParams.set('code', this.#sealer.seal('code', code, this.#now() + CODE_SECONDS));
    if (pending.state !== undefined) url.searchParams.set('state', pending.state);
    return { kind: 'redirect', url: url.href };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
    return this.#code(client, authorizationCode).codeChallenge;
  }

  /** Step 3: the app trades its code for tokens. */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const code = this.#code(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    const now = this.#now();
    for (const [id, expiresAt] of this.#usedCodes) if (expiresAt <= now) this.#usedCodes.delete(id);
    if (this.#usedCodes.has(code.id)) throw new InvalidGrantError('The authorization code was already used');
    this.#usedCodes.set(code.id, now + CODE_SECONDS);

    return this.#issue(code.cid, code.url, code);
  }

  /** Later: the app renews its tokens. Taiga renews its own pair at the same time. */
  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const refresh = this.#sealer.open<Refresh>('refresh', refreshToken)?.data;
    if (refresh === undefined || refresh.cid !== fingerprint(client.client_id)) {
      throw new InvalidGrantError('The refresh token is not valid. Sign in again.');
    }
    if (!this.#serves(refresh.url)) throw new InvalidGrantError('Sign in again.');
    const tokens = await this.#taigaAt(refresh.url).refresh(refresh.refresh);
    if (tokens === undefined) throw new InvalidGrantError('Taiga ended the session. Sign in again.');
    return this.#issue(refresh.cid, refresh.url, tokens);
  }

  /** Every request to the MCP endpoint: who is this, and with which Taiga token? */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const access = this.#sealer.open<Access>('access', token);
    if (access?.expiresAt === undefined || !this.#serves(access.data.url)) {
      throw new InvalidTokenError('The access token is not valid');
    }
    return {
      token,
      clientId: access.data.cid,
      scopes: [SCOPE],
      expiresAt: access.expiresAt,
      resource: this.#resource,
      extra: { taigaUrl: access.data.url, taigaToken: access.data.token },
    };
  }

  /** A server set up for one Taiga does not honour tokens for another. */
  #serves(taigaUrl: string): boolean {
    return this.#fixedTaiga === undefined || this.#fixedTaiga === taigaUrl;
  }

  #code(client: OAuthClientInformationFull, authorizationCode: string): Code {
    const code = this.#sealer.open<Code>('code', authorizationCode)?.data;
    if (code === undefined || code.cid !== fingerprint(client.client_id)) {
      throw new InvalidGrantError('The authorization code is not valid or has expired');
    }
    return code;
  }

  #issue(cid: string, url: string, taiga: TaigaTokens): OAuthTokens {
    const now = this.#now();
    const taigaExpiry = tokenExpiry(taiga.token);
    const accessExpiry =
      taigaExpiry === undefined ? now + FALLBACK_ACCESS_SECONDS : taigaExpiry - MARGIN_SECONDS;
    const access: Access = { cid, url, token: taiga.token };

    let refreshToken: string | undefined;
    if (taiga.refresh !== undefined) {
      const refreshExpiry = tokenExpiry(taiga.refresh);
      const refresh: Refresh = { cid, url, refresh: taiga.refresh };
      refreshToken = this.#sealer.seal(
        'refresh',
        refresh,
        refreshExpiry === undefined ? now + FALLBACK_REFRESH_SECONDS : refreshExpiry - MARGIN_SECONDS,
      );
    }
    return {
      access_token: this.#sealer.seal('access', access, accessExpiry),
      token_type: 'bearer',
      expires_in: Math.max(accessExpiry - now, 0),
      scope: SCOPE,
      ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    };
  }
}
