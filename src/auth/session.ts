import { cookies } from "next/headers";
import { getConfig } from "@/config";
import type { TokenSet } from "./oauth";
import { chunk, open, seal } from "./seal";

const PREFIX = "pg_sess";
const OAUTH_COOKIE = "pg_oauth";

export type Session = TokenSet;

type OauthHandoff = {
  state: string;
  verifier: string;
  /** Set by /api/auth/start?watch=1. The result is shown once for the alert setup instead of becoming a session. */
  watch?: boolean;
};

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function writeSession(session: Session): Promise<void> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) throw new Error("SESSION_SECRET is not set.");
  const parts = chunk(seal(session, sessionSecret));
  const jar = await cookies();
  const options = cookieOptions(60 * 60 * 24 * 30);
  jar.set(`${PREFIX}_n`, String(parts.length), options);
  parts.forEach((part, index) => jar.set(`${PREFIX}_${index}`, part, options));
  for (let index = parts.length; index < 6; index += 1) {
    jar.set(`${PREFIX}_${index}`, "", { ...options, maxAge: 0 });
  }
}

export async function readSession(): Promise<Session | null> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) return null;
  const jar = await cookies();
  const count = Number(jar.get(`${PREFIX}_n`)?.value ?? "0");
  if (!Number.isInteger(count) || count <= 0) return null;
  let sealed = "";
  for (let index = 0; index < count; index += 1) {
    const part = jar.get(`${PREFIX}_${index}`)?.value;
    if (!part) return null;
    sealed += part;
  }
  const session = open<Session>(sealed, sessionSecret);
  if (!session?.accessToken || typeof session.expiresAt !== "number") return null;
  return { ...session, refreshToken: session.refreshToken ?? null };
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const options = cookieOptions(0);
  jar.set(`${PREFIX}_n`, "", options);
  for (let index = 0; index < 6; index += 1) jar.set(`${PREFIX}_${index}`, "", options);
}

export async function writeOauthHandoff(handoff: OauthHandoff): Promise<void> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) throw new Error("SESSION_SECRET is not set.");
  const jar = await cookies();
  jar.set(OAUTH_COOKIE, seal(handoff, sessionSecret), cookieOptions(10 * 60));
}

export async function readOauthHandoff(): Promise<OauthHandoff | null> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) return null;
  const jar = await cookies();
  const token = jar.get(OAUTH_COOKIE)?.value;
  if (!token) return null;
  const handoff = open<OauthHandoff>(token, sessionSecret);
  if (!handoff?.state || !handoff.verifier) return null;
  return { state: handoff.state, verifier: handoff.verifier, watch: handoff.watch === true };
}

export async function clearOauthHandoff(): Promise<void> {
  const jar = await cookies();
  jar.set(OAUTH_COOKIE, "", cookieOptions(0));
}

const ARM_COOKIE = "pg_alert_arm";

/**
 * Turning alerts on stores a Buffer grant on the server, so it is gated: the owner proves they can read
 * the deployment's CRON_SECRET on the setup page, which arms this 10-minute cookie. Only an armed browser
 * can finish the "connect for alerts" sign-in.
 */
export async function armAlertSetup(): Promise<void> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) throw new Error("SESSION_SECRET is not set.");
  const jar = await cookies();
  jar.set(ARM_COOKIE, seal({ until: Date.now() + 10 * 60_000 }, sessionSecret), cookieOptions(10 * 60));
}

export async function isAlertSetupArmed(): Promise<boolean> {
  const { sessionSecret } = getConfig();
  if (!sessionSecret) return false;
  const jar = await cookies();
  const value = jar.get(ARM_COOKIE)?.value;
  if (!value) return false;
  const armed = open<{ until?: number }>(value, sessionSecret);
  return typeof armed?.until === "number" && armed.until > Date.now();
}

export async function clearAlertSetup(): Promise<void> {
  const jar = await cookies();
  jar.set(ARM_COOKIE, "", cookieOptions(0));
}
