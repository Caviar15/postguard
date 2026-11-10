import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { Dashboard } from "@/components/Dashboard";
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
  searchParams: Promise<{ days?: string; refresh?: string; org?: string; retried?: string }>;
}) {
  const params = await searchParams;
  const days = clampDays(params.days, getConfig().windowDays);
  const session = await readSession();
  if (!session) return <ConnectPrompt />;

  const nextPath = `/dashboard?days=${days}${params.org ? `&org=${encodeURIComponent(params.org)}` : ""}`;
  if (session.expiresAt < Date.now() + 60_000) {
    redirect(`/api/auth/refresh?next=${encodeURIComponent(nextPath)}`);
  }

  const key = cacheKey(session.refreshToken, params.org ?? "default", days);
  if (params.refresh !== "1") {
    const cached = readCachedReport(key);
    if (cached) return <Dashboard report={cached} basePath="/dashboard" />;
  }

  try {
    const report = await scanLive({
      accessToken: session.accessToken,
      windowDays: days,
      organizationId: params.org ?? null,
    });
    writeCachedReport(key, report);
    if (params.refresh === "1") redirect(nextPath);
    return <Dashboard report={report} basePath="/dashboard" />;
  } catch (error) {
    if (error instanceof BufferAuthError) {
      if (params.retried === "1") {
        return <ScanError message="Buffer rejected the saved session. Connect the account again." />;
      }
      const retryPath = `${nextPath}${nextPath.includes("?") ? "&" : "?"}retried=1`;
      redirect(`/api/auth/refresh?next=${encodeURIComponent(retryPath)}`);
    }
    const message = error instanceof BufferRateLimitError
      ? `Buffer’s shared rate limit is exhausted. Retry after ${error.retryAfter} seconds. The demo queue does not use quota.`
      : error instanceof Error
        ? error.message
        : "The scan failed.";
    return <ScanError message={message} />;
  }
}

function ConnectPrompt() {
  const configured = oauthConfigured();
  return (
    <>
      <header className="wrap topbar"><Brand /></header>
      <main id="main" className="wrap hero">
        <p className="kicker">Not connected</p>
        <h1>Connect Buffer to scan a live queue.</h1>
        <p className="lede">
          {configured
            ? "PostGuard asks for account:read, posts:read, and offline_access. It cannot edit posts."
            : "This deployment has no Buffer client id yet. Use the demo queue, or set the env vars in the README."}
        </p>
        <div className="cta-row">
          <Link className="button" href="/api/auth/start">Connect Buffer</Link>
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
