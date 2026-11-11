import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.0.0.0", 24, "ipv4");
blocked.addSubnet("192.0.2.0", 24, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addSubnet("198.18.0.0", 15, "ipv4");
blocked.addSubnet("198.51.100.0", 24, "ipv4");
blocked.addSubnet("203.0.113.0", 24, "ipv4");
blocked.addSubnet("224.0.0.0", 4, "ipv4");
blocked.addAddress("255.255.255.255", "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type LookupFn = (hostname: string) => Promise<string[]>;

export function isBlockedAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const address = mapped?.[1] ?? ip;
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

/** http(s) only, no credentials, and only the scheme's default port. */
export function assertPublicUrlShape(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are checked.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with credentials are not checked.");
  }
  const expected = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expected) {
    throw new UnsafeUrlError("Only the default port for the scheme is checked.");
  }
  if (!url.hostname) throw new UnsafeUrlError("The URL has no host.");
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** Resolve the host and reject any address that is not a public unicast target. */
export async function assertPublicHttpUrl(raw: string, lookupImpl: LookupFn = defaultLookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("The URL could not be parsed.");
  }
  assertPublicUrlShape(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = await lookupImpl(hostname);
  } catch {
    throw new UnsafeUrlError("The host did not resolve.");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("The host did not resolve.");
  if (addresses.some((address) => isBlockedAddress(address))) {
    throw new UnsafeUrlError("The host resolves to a private, loopback, link-local, or metadata address.");
  }
}
