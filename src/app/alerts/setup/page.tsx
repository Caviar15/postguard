import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { alertSettings, storeFromEnv } from "@/alerts/deps";
import { secretConfigured } from "@/alerts/run";
import { oauthConfigured } from "@/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert setup · PostGuard", robots: { index: false, follow: false } };

const PROBLEMS: Record<string, string> = {
  code: "That setup code is not right, or the sign-in took longer than 10 minutes. Start again.",
  store: "The alert store is not reachable. Try again in a moment.",
  refresh: "Buffer did not return a refresh token, which background alerts need. Check that the app asks for offline_access.",
};

export default async function AlertSetupPage({ searchParams }: { searchParams: Promise<{ on?: string; off?: string; problem?: string }> }) {
  const params = await searchParams;
  const { store, configured } = storeFromEnv();
  const env = process.env;
  let enabled: boolean | null = null;
  if (configured && env.SESSION_SECRET) {
    try {
      enabled = await store.isEnabled();
    } catch {
      enabled = null;
    }
  }
  const ready =
    oauthConfigured() &&
    configured &&
    Boolean(secretConfigured(env)) &&
    Boolean(env.RESEND_API_KEY?.trim()) &&
    Boolean(alertSettings(env).email);
  const problem = params.problem ? PROBLEMS[params.problem] : null;

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <Link className="button secondary small" href="/demo/alert">Preview the alert email</Link>
        </div>
      </header>
      <main id="main" className="wrap hero">
        <p className="kicker">Owner setup</p>
        <h1>Alerts that come to you.</h1>
        <p className="lede">
          Once a day PostGuard checks the posts that will publish in roughly the next 27 hours and emails you only when one has a Blocker or High problem. Same read-only access as the dashboard: <code>account:read</code> and <code>posts:read</code>, plus <code>offline_access</code> so the check can run while you are away.
        </p>

        {params.on ? <p className="banner" role="status">Alerts are on. The first check runs at the next scheduled time.</p> : null}
        {params.off ? <p className="banner" role="status">Alerts are off and the saved Buffer access was deleted.</p> : null}
        {problem ? <p className="banner" role="alert">{problem}</p> : null}

        <section className="card setup-card">
          <h2>{enabled ? "Alerts are on" : "Turn alerts on"}</h2>
          <p>
            This is a separate Buffer sign-in from the dashboard, because Buffer refresh tokens are single use. PostGuard saves that sign-in&rsquo;s refresh token on the server, encrypted, so the daily check can run while you are away. Turning alerts off, or the unsubscribe link in any alert, deletes it.
          </p>
          <form action="/api/alerts/enable" method="post" className="setup-form">
            <label htmlFor="code">Setup code <span className="fine">(the secret you set for this deployment)</span></label>
            <input id="code" name="code" type="password" autoComplete="off" required minLength={16} />
            <div className="cta-row">
              <button type="submit" className="button" disabled={!ready}>{enabled ? "Connect again" : "Connect Buffer for alerts"}</button>
            </div>
          </form>
          {enabled ? (
            <form action="/api/alerts/disable" method="post" className="setup-form">
              <input name="code" type="password" autoComplete="off" required minLength={16} aria-label="Setup code" />
              <div className="cta-row">
                <button type="submit" className="button secondary">Turn alerts off</button>
              </div>
            </form>
          ) : null}
        </section>

        {ready ? null : (
          <p className="banner" role="note" data-testid="setup-not-ready">
            Alerts are not available on this deployment yet. The owner needs to finish the setup described in the README.
          </p>
        )}
      </main>
    </>
  );
}
