import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

/**
 * When people may type the address of their own Taiga, the server makes requests to hosts
 * chosen by strangers. This file keeps those requests on the public internet: a typed address
 * must not be a way to reach the machine the server runs on, or the network around it.
 */

const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, where cloud hosts keep their metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64: an IPv4 address in disguise
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/** Whether an IP address (not a name) is one a stranger may send the server to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked against the IPv4 list too.
  return !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Taiga cloud is opened at one address and answers its API at another. */
const TAIGA_CLOUD = new Set(['taiga.io', 'www.taiga.io', 'tree.taiga.io', 'api.taiga.io']);

/**
 * The API host for what a person typed as "the address of my Taiga", or `undefined` when it
 * cannot be one. People paste whatever is in their address bar, so the scheme may be missing
 * and a path may follow; only a host name reached over HTTPS is kept.
 */
export function taigaAddress(typed: string): string | undefined {
  const text = typed.trim();
  if (text === '' || text.length > 300) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  // A password is never sent over plain HTTP: http:// is read as https://.
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
  const host = url.hostname.toLowerCase();
  // Names only: no bare IP addresses, no single-label names such as "localhost".
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return undefined;
  if (TAIGA_CLOUD.has(host)) return 'https://api.taiga.io';
  return url.origin;
}

class NotPublicError extends Error {
  override readonly name = 'NotPublicError';
  constructor(host: string) {
    super(`${host} is not an address on the public internet`);
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Name resolution for the guarded connections: a name is refused if any address it resolves
 * to is not public. Checking here, at the moment of connecting, also covers redirects and a
 * name that changes its answer between two look-ups.
 */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
    } else if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new NotPublicError(hostname), []);
    } else if (options.all) {
      callback(null, addresses);
    } else {
      const [first] = addresses as [LookupAddress, ...LookupAddress[]];
      callback(null, first.address, first.family);
    }
  });
}

const connect = buildConnector({ lookup: guardedLookup as never });

const agent = new Agent({
  connect: (options, callback) => {
    // A literal IP address is connected to without a look-up, so it is checked here.
    const host = options.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && !isPublicAddress(host)) {
      callback(new NotPublicError(host), null);
      return;
    }
    connect(options, callback);
  },
});

/** `fetch` that only ever connects to public addresses. */
export const guardedFetch = ((
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1],
) => undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof fetch;
