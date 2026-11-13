import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** What a sealed value is for. A value sealed for one purpose does not open as another. */
export type Purpose = 'client' | 'login' | 'code' | 'access' | 'refresh';

export interface Opened<T> {
  readonly data: T;
  /** Seconds since the epoch, when the value was sealed with an expiry. */
  readonly expiresAt: number | undefined;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts small JSON values with a key derived from the server secret (AES-256-GCM).
 *
 * The hosted server keeps no database: everything it must remember between two requests (a
 * registered client, a pending sign-in, an authorization code, the Taiga tokens behind an access
 * token) travels inside the value it hands out, readable and changeable only by this server.
 */
export class Sealer {
  readonly #key: Buffer;
  readonly #now: () => number;

  constructor(secret: string, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.#key = Buffer.from(hkdfSync('sha256', secret, 'taiga-mcp', 'seal-v1', 32));
    this.#now = now;
  }

  /** `expiresAt` is in seconds since the epoch; without it the value never expires. */
  seal(purpose: Purpose, data: unknown, expiresAt?: number): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const text = JSON.stringify(expiresAt === undefined ? { d: data } : { d: data, e: expiresAt });
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  /** The value, or `undefined` when it was not sealed by this server for this purpose, or has expired. */
  open<T>(purpose: Purpose, sealed: string): Opened<T> | undefined {
    try {
      const raw = Buffer.from(sealed, 'base64url');
      if (raw.length <= IV_BYTES + TAG_BYTES) return undefined;
      const decipher = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const text = Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
      const { d, e } = JSON.parse(text) as { d: T; e?: number };
      if (e !== undefined && e <= this.#now()) return undefined;
      return { data: d, expiresAt: e };
    } catch {
      return undefined;
    }
  }
}
