import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { Brand } from "@/components/Brand";
import { Dashboard } from "@/components/Dashboard";
import { nextAuthStep } from "@/auth/flow";
import { readSession } from "@/auth/session";
import { BufferAuthError, BufferRateLimitError } from "@/buffer/client";
import { clampDays, getConfig, oauthConfigured } from "@/config";
import { cacheKey, readCachedReport, writeCachedReport } from "@/scan/cache";
import { scanLive } from "@/scan/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; refresh?: string; org?: string; retried?: string; drafts?: string }>;
}) {
  const params = await searchParams;
  const days = clampDays(params.days, getConfig().windowDays);
  const includeDrafts = params.drafts === "1";
  const session = await readSession();
  if (!session) return <ConnectPrompt expired={false} />;

  const nextPath = dashboardPath(days, params.org, includeDrafts);
  const step = nextAuthStep(session);
  if (step === "reconnect") return <ConnectPrompt expired />;
  if (step === "refresh") redirect(`/api/auth/refresh?next=${encodeURIComponent(nextPath)}`);

  const key = cacheKey(session.refreshToken ?? session.accessToken, params.org ?? "default", days, includeDrafts);
  if (params.refresh !== "1") {
    const cached = readCachedReport(key);
    if (cached) {
      return (
        <Dashboard
          report={cached}
          basePath="/dashboard"
          sessionNote={sessionNote(session.refreshToken)}
        />
      );
    }
  }

  let report;
  try {
    report = await scanLive({
      accessToken: session.accessToken,
      windowDays: days,
      organizationId: params.org ?? null,
      includeDrafts,
    });
    writeCachedReport(key, report);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof BufferAuthError) {
      if (!session.refreshToken || params.retried === "1") return <ConnectPrompt expired />;
      const retryPath = `${nextPath}${nextPath.includes("?") ? "&" : "?"}retried=1`;
      redirect(`/api/auth/refresh?next=${encodeURIComponent(retryPath)}`);
    }
    const message = error instanceof BufferRateLimitError
      ? `Buffer’s shared rate limit is exhausted. Try again in ${error.waitLabel}. The demo queue does not use quota.`
      : error instanceof Error
        ? error.message
        : "The scan failed.";
    return <ScanError message={message} />;
  }

  // Do not redirect() to strip ?refresh=1. This segment has a loading.tsx, so the
  // 200 shell is already sent and redirect() would be a 1s meta refresh. The
  // dashboard removes the flag with history.replaceState after this render, so a
  // reload reads the cache.
  return <Dashboard report={report} basePath="/dashboard" sessionNote={sessionNote(session.refreshToken)} />;
}

function dashboardPath(days: number, org: string | undefined, drafts: boolean): string {
  const params = new URLSearchParams({ days: String(days) });
  if (org) params.set("org", org);
  if (drafts) params.set("drafts", "1");
  return `/dashboard?${params.toString()}`;
}

function sessionNote(refreshToken: string | null): string | null {
  if (refreshToken) return null;
  return "Buffer did not return a refresh token, so this sign-in lasts about an hour. When it expires, PostGuard asks you to connect again. Nothing crashes, and nothing is posted.";
}

function ConnectPrompt({ expired }: { expired: boolean }) {
  const configured = oauthConfigured();
  return (
    <>
      <header className="wrap topbar"><Brand /></header>
      <main id="main" className="wrap hero">
        <p className="kicker">{expired ? "Session ended" : "Not connected"}</p>
        <h1>{expired ? "Connect Buffer again." : "Connect Buffer to scan a live queue."}</h1>
        <p className="lede">
          {expired
            ? "The access token lasted about an hour and there is no refresh token to renew it. Connect again to keep reading the queue. PostGuard still cannot edit or publish anything."
            : configured
              ? "PostGuard asks for account:read and posts:read. It cannot edit or publish posts."
              : "This deployment has no Buffer client id yet. Use the demo queue, or set the env vars in the README."}
        </p>
        <div className="cta-row">
          <a className="button" href="/api/auth/start">Connect Buffer</a>
          <Link className="button secondary" href="/demo">Open the demo</Link>
        </div>
      </main>
    </>
  );
}

function ScanError({ message }: { message: string }) {
  return (
    <>
      <header className="wrap topbar"><Brand /></header>
      <main id="main" className="wrap hero">
        <p className="kicker">Scan stopped</p>
        <h1>The live queue could not be read.</h1>
        <p className="banner" role="alert">{message}</p>
        <div className="cta-row">
          <Link className="button" href="/dashboard?refresh=1">Try again</Link>
          <Link className="button secondary" href="/demo">Open the demo</Link>
        </div>
      </main>
    </>
  );
}
