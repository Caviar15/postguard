export type AppConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  sessionSecret: string;
  windowDays: number;
};

export function getConfig(): AppConfig {
  const windowDays = Number(process.env.POSTGUARD_WINDOW_DAYS ?? "7");
  return {
    clientId: process.env.BUFFER_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.BUFFER_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.BUFFER_REDIRECT_URI?.trim() || null,
    sessionSecret: process.env.SESSION_SECRET?.trim() ?? "",
    windowDays: Number.isFinite(windowDays) ? windowDays : 7,
  };
}

export function oauthConfigured(config: AppConfig = getConfig()): boolean {
  return Boolean(config.clientId && config.sessionSecret);
}

export function redirectUriFor(request: Request, config: AppConfig = getConfig()): string {
  if (config.redirectUri) return config.redirectUri;
  const url = new URL(request.url);
  return `${url.origin}/api/auth/callback`;
}

export function clampDays(value: unknown, fallback = 7): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(1, Math.round(parsed)));
}
