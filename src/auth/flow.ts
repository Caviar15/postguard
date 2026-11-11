export type AuthStep = "ok" | "refresh" | "reconnect";

/**
 * A live session with no refresh token is normal: Buffer's app form does not
 * offer offline_access, and the token response then has no refresh_token.
 * The access token still lasts about an hour. After that, ask the person to
 * connect again. Never throw.
 */
export function nextAuthStep(
  session: { refreshToken: string | null; expiresAt: number },
  now = Date.now(),
): AuthStep {
  if (session.expiresAt >= now + 60_000) return "ok";
  return session.refreshToken ? "refresh" : "reconnect";
}
