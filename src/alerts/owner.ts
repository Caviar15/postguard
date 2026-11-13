import { NextResponse } from "next/server";
import { nextAuthStep } from "@/auth/flow";
import { readSession, type Session } from "@/auth/session";
import { BufferAuthError, BufferClient } from "@/buffer/client";
import { readOrganizations } from "@/buffer/normalize";
import { ACCOUNT_QUERY } from "@/buffer/queries";
import { storeFromEnv } from "./deps";
import { UnreadableGrantError } from "./crypto";
import type { RedisAlertStore, StoredSubscriber } from "./redis";

type Env = Record<string, string | undefined>;

/**
 * Who may turn alerts on or off, and press the demo test button: the Buffer account that owns the alert grant,
 * proven by a normal signed-in PostGuard session. No typed code.
 */
export type OwnerAccess =
  /** `claim` is true when nobody owns alerts yet and this account would become the owner by turning them on. */
  | { status: "owner"; accountId: string; claim: boolean }
  | { status: "signed-out" }
  /** The session's access token is about to expire and has a refresh token: renew it, then come back. */
  | { status: "refresh" }
  | { status: "not-owner" }
  /** Buffer, the alert store or the deployment could not answer. Nothing is allowed. */
  | { status: "unavailable" };

export type OwnerRecord = StoredSubscriber | "unreadable" | null;

export function configuredOwnerId(env: Env): string | null {
  return env.ALERT_OWNER_BUFFER_ACCOUNT_ID?.trim() || null;
}

/**
 * Decide the owner. Order:
 * 1. an alert grant exists and has an account id saved with it: that account (kept after turn-off too);
 * 2. otherwise the ALERT_OWNER_BUFFER_ACCOUNT_ID setting;
 * 3. otherwise, and only when no working grant exists, the first signed-in account to turn alerts on.
 * A working grant with no saved id and no setting has no known owner: nobody passes (fail closed).
 */
export function decideOwner(accountId: string, record: OwnerRecord, env: Env): { owner: boolean; claim: boolean } {
  const saved = record && record !== "unreadable" ? record.accountId : undefined;
  if (saved) return { owner: saved === accountId, claim: false };
  const configured = configuredOwnerId(env);
  if (configured) return { owner: configured === accountId, claim: false };
  const live = record === "unreadable" || Boolean(record && !record.unsubscribed && record.refreshToken);
  if (live) return { owner: false, claim: false };
  return { owner: true, claim: true };
}

export type OwnerDeps = {
  readSession: () => Promise<Session | null>;
  /** The Buffer account id for an access token (the read-only `account` query). */
  accountIdFor: (accessToken: string) => Promise<string | null>;
  store: Pick<RedisAlertStore, "readSubscriber">;
  storeConfigured: boolean;
  env: Env;
  now: () => number;
};

export async function fetchAccountId(accessToken: string, fetchImpl?: typeof fetch): Promise<string | null> {
  const data = await new BufferClient(accessToken, fetchImpl).query<unknown>(ACCOUNT_QUERY);
  return readOrganizations(data).accountId;
}

export function ownerDepsFromEnv(env: Env = process.env): OwnerDeps {
  const { store, configured } = storeFromEnv(env);
  return { readSession, accountIdFor: (token) => fetchAccountId(token), store, storeConfigured: configured, env, now: Date.now };
}

export async function authorizeOwner(deps: OwnerDeps = ownerDepsFromEnv()): Promise<OwnerAccess> {
  const session = await deps.readSession();
  if (!session) return { status: "signed-out" };
  const step = nextAuthStep(session, deps.now());
  if (step === "reconnect") return { status: "signed-out" };
  if (step === "refresh") return { status: "refresh" };

  let accountId: string | null;
  try {
    accountId = await deps.accountIdFor(session.accessToken);
  } catch (error) {
    // Buffer rejected the token: the sign-in is not valid any more. Anything else is an outage, not "signed out".
    return error instanceof BufferAuthError ? { status: "signed-out" } : { status: "unavailable" };
  }
  if (!accountId) return { status: "unavailable" };

  if (!deps.storeConfigured) return { status: "unavailable" };
  let record: OwnerRecord;
  try {
    record = await deps.store.readSubscriber();
  } catch (error) {
    if (!(error instanceof UnreadableGrantError)) return { status: "unavailable" };
    record = "unreadable";
  }
  const decision = decideOwner(accountId, record, deps.env);
  return decision.owner ? { status: "owner", accountId, claim: decision.claim } : { status: "not-owner" };
}

/**
 * CSRF guard for the POST routes, on top of the SameSite=Lax cookies: the browser's Origin (or, failing that,
 * Sec-Fetch-Site) must say the request came from this site. A request that says nothing is refused.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host")?.trim() || new URL(request.url).host;
    return originHost === host;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** Where a visitor goes when they may not do an owner action. Says as little as possible about the deployment. */
export function denyOwner(request: Request, access: Exclude<OwnerAccess, { status: "owner" }>): Response {
  if (access.status === "refresh") {
    return NextResponse.redirect(new URL(`/api/auth/refresh?next=${encodeURIComponent("/alerts/setup")}`, request.url), 303);
  }
  const problem = access.status === "signed-out" ? "signin" : access.status === "not-owner" ? "owner" : "check";
  return NextResponse.redirect(new URL(`/alerts/setup?problem=${problem}`, request.url), 303);
}

export function crossSite(): Response {
  return new Response("This request did not come from PostGuard.", { status: 403, headers: { "cache-control": "no-store" } });
}
