import { timingSafeEqual } from "node:crypto";
import { secretConfigured } from "./run";

/** Does this typed value equal the deployment's CRON_SECRET? False when no usable secret is configured. */
export function hasSecretValue(value: string, env: Record<string, string | undefined>): boolean {
  const secret = secretConfigured(env);
  if (!secret) return false;
  const a = Buffer.from(value.trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
