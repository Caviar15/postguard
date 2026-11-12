import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { TokenReveal } from "@/components/TokenReveal";
import { readWatchGrant } from "@/auth/session";
import { oauthConfigured } from "@/config";
import { storeFromEnv } from "@/alerts/token-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert setup · PostGuard", robots: { index: false, follow: false } };

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export default async function AlertSetupPage() {
  const grant = await readWatchGrant();
  const configured = oauthConfigured();
  const store = storeFromEnv();

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <Link className="button secondary small" href="/demo/alert">Preview the alert email</Link>
        </div>
      </header>
      <main id="main" className="wrap hero">
        <p className="kicker">Owner setup · one time</p>
        <h1>Alerts that come to you.</h1>
        <p className="lede">
          PostGuard checks your Buffer queue once a day in the background and emails you only when a Blocker or High problem is found. Same read-only access as the dashboard: <code>account:read</code> and <code>posts:read</code>.
        </p>

        {!grant ? (
          <section className="card setup-card">
            <h2>1. Connect Buffer for alerts</h2>
            <p>
              This is a separate sign-in from the dashboard, on purpose. Buffer refresh tokens are single use, so the background job needs a token of its own. The token is shown to you once, here, and is not logged or stored by this page.
            </p>
            <div className="cta-row" style={{ marginTop: 14 }}>
              {configured ? <a className="button" href="/api/auth/start?watch=1">Connect Buffer for alerts</a> : <span className="banner">This deployment has no Buffer client id yet.</span>}
              <Link className="button secondary" href="/demo/alert">See what the email looks like</Link>
            </div>
          </section>
        ) : grant.refreshToken ? (
          <>
            <section className="card setup-card">
              <h2>2. Copy your refresh token</h2>
              <p>Paste it into the Vercel environment variable <code>BUFFER_REFRESH_TOKEN</code> for Production, then redeploy. It disappears from this browser after 15 minutes.</p>
              <TokenReveal token={grant.refreshToken} />
              <form action="/api/alerts/clear" method="post">
                <button type="submit" className="button secondary small">I have copied it, clear it now</button>
              </form>
            </section>
            <section className="card setup-card">
              <h2>3. Check what is set</h2>
              <p>Names only. Values are never shown.</p>
              <ul className="setup-checks" data-testid="setup-checks">
                {[
                  ["CRON_SECRET", isSet("CRON_SECRET")],
                  ["BUFFER_REFRESH_TOKEN", isSet("BUFFER_REFRESH_TOKEN")],
                  ["RESEND_API_KEY", isSet("RESEND_API_KEY")],
                  ["ALERT_EMAIL_TO", isSet("ALERT_EMAIL_TO")],
                  ["Token store (Upstash Redis)", Boolean(store)],
                ].map(([name, ok]) => (
                  <li key={String(name)} className={ok ? "ok" : "missing"}>
                    <span aria-hidden="true">{ok ? "✓" : "–"}</span> {name} <span className="fine">{ok ? "set" : "not set"}</span>
                  </li>
                ))}
              </ul>
              {store ? null : (
                <p className="banner" role="note">
                  Without a token store, the token works for one run only: Buffer replaces it on every use. Connect Upstash Redis from the Vercel Marketplace so PostGuard can keep the newest one.
                </p>
              )}
            </section>
          </>
        ) : (
          <section className="card setup-card">
            <h2>Buffer did not return a refresh token</h2>
            <p>Background alerts need the <code>offline_access</code> permission. Without it the sign-in lasts an hour, which a daily check cannot use.</p>
            <form action="/api/alerts/clear" method="post" style={{ marginTop: 12 }}>
              <button type="submit" className="button secondary small">Start over</button>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
