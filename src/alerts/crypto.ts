import { hkdfSync } from "node:crypto";
import { openWithKey, sealWithKey } from "@/auth/seal";

/**
 * The saved Buffer grant is encrypted with its own key, derived from SESSION_SECRET with HKDF and a label that
 * nothing else uses. The session cookies use a plain hash of the same secret, so a cookie value can never be
 * opened (or forged) as a stored grant, or the other way round. Rotating SESSION_SECRET still invalidates both:
 * that is detected and reported (UnreadableGrantError), never treated as "empty".
 */
export const GRANT_KEY_LABEL = "postguard/alerts/grant-encryption/v1";

export function grantKey(secret: string): Buffer {
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return Buffer.from(hkdfSync("sha256", secret, "postguard", GRANT_KEY_LABEL, 32));
}

export const sealGrant = (payload: unknown, secret: string): string => sealWithKey(payload, grantKey(secret));
export const openGrant = <T>(token: string, secret: string): T | null => openWithKey<T>(token, grantKey(secret));

/** A grant is stored but cannot be decrypted: SESSION_SECRET changed or the value is damaged. */
export class UnreadableGrantError extends Error {
  constructor() {
    super("The saved alert grant cannot be read. Turn alerts on again at /alerts/setup.");
    this.name = "UnreadableGrantError";
  }
}
