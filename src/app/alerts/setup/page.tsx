import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { alertSettings, storeFromEnv } from "@/alerts/deps";
import { authorizeOwner, type OwnerAccess } from "@/alerts/owner";
import { secretConfigured } from "@/alerts/run";
import { oauthConfigured } from "@/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert setup · PostGuard", robots: { index: false, follow: false } };

const PROBLEMS: Record<string, string> = {
  signin: "Sign in with Buffer first.",
  owner: "This Buffer account is not the owner of PostGuard alerts, so nothing was changed.",
  check: "PostGuard could not check your Buffer account right now. Try again in a moment.",
  arm: "The alert sign-in took longer than 10 minutes or did not start here. Use the switch again.",
  store: "The alert store is not reachable. Try again in a moment.",
  refresh: "Buffer did not return a refresh token, which background alerts need. Check that the app asks for offline_access.",
  "test-empty": "No issues were found in the queue, including drafts, so no email was sent.",
  "test-grant": "Alerts are not connected to Buffer, so no test email was sent. Turn alerts off and on again.",
  "test-read": "PostGuard could not read your Buffer queue, so no test email was sent.",
  "test-mail": "The test email could not be sent. Try again in a moment.",
  "test-wait": "A test alert was just sent. Wait a minute and try again.",
  "test-email": "No alert email address is set, so nothing was sent.",
};

function issueCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export default async function AlertSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string; off?: string; problem?: string; sent?: string; issues?: string }>;
}) {
  const params = await searchParams;
  const available = oauthConfigured();
  const access: OwnerAccess | null = available ? await authorizeOwner() : null;
  if (access?.status === "refresh") redirect(`/api/auth/refresh?next=${encodeURIComponent("/alerts/setup")}`);
  const owner = access?.status === "owner";

  // Nothing about the alert setup (on or off, what is configured) is shown to anyone who is not the owner.
  let enabled = false;
  let ready = false;
  if (owner) {
    const { store, configured } = storeFromEnv();
    const env = process.env;
    if (configured && env.SESSION_SECRET) {
      try {
        enabled = await store.isEnabled();
      } catch {
        enabled = false;
      }
    }
    ready = configured && Boolean(secretConfigured(env)) && Boolean(env.RESEND_API_KEY?.trim()) && Boolean(alertSettings(env).email);
  }
  const problem = params.problem ? PROBLEMS[params.problem] : null;
  const sentCount = params.sent ? issueCount(params.issues) : null;
  const sentMessage =
    params.sent && sentCount !== null
      ? `Test alert sent to your inbox (${sentCount} ${sentCount === 1 ? "issue" : "issues"})`
      : params.sent
        ? "Test alert sent to your inbox."
        : null;

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <Link href="/dashboard">Dashboard</Link>
          <Link className="button secondary small" href="/demo/alert">Preview the alert email</Link>
        </div>
      </header>
      <main id="main" className="wrap hero">
        <p className="kicker">Email alerts</p>
        <h1>Alerts that come to you.</h1>
        <p className="lede">
          Once a day PostGuard checks the posts that will publish in roughly the next 27 hours and emails you only when one has a Blocker or High problem. Same read-only access as the dashboard: <code>account:read</code> and <code>posts:read</code>, plus <code>offline_access</code> so the check can run while you are away.
        </p>

        {owner && params.on ? <p className="banner" role="status">Alerts are on. The first check runs at the next scheduled time.</p> : null}
        {owner && params.off ? <p className="banner" role="status">Alerts are off and the saved Buffer access was deleted.</p> : null}
        {owner && sentMessage ? <p className="banner" role="status" data-testid="send-now-result">{sentMessage}</p> : null}
        {problem ? <p className="banner" role="alert">{problem}</p> : null}

        {!available ? (
          <p className="banner" role="note" data-testid="setup-not-ready">
            Alerts are not available on this deployment yet. The owner needs to finish the setup described in the README.
          </p>
        ) : null}

        {access?.status === "signed-out" ? (
          <section className="card setup-card" data-testid="alerts-signin">
            <h2>Sign in to manage alerts</h2>
            <p>Only the Buffer account that owns this PostGuard can turn email alerts on or off. Sign in with Buffer to continue. There is nothing to type.</p>
            {/* A plain anchor: next/link would prefetch this route handler and set the OAuth state cookie early. */}
            <div className="cta-row">
              <a className="button" href={`/api/auth/start?next=${encodeURIComponent("/alerts/setup")}`}>Sign in with Buffer</a>
            </div>
          </section>
        ) : null}

        {access?.status === "not-owner" ? (
          <section className="card setup-card" data-testid="alerts-not-owner">
            <h2>This is not the owner account</h2>
            <p>You are signed in to Buffer, but not with the account that owns PostGuard alerts, so the switch is hidden. Sign out and sign in with the owner account to change it.</p>
            <form action="/api/auth/logout" method="post" className="cta-row">
              <input type="hidden" name="next" value="/alerts/setup" />
              <button type="submit" className="button">Sign out and try another account</button>
            </form>
          </section>
        ) : null}

        {access?.status === "unavailable" ? (
          <section className="card setup-card" data-testid="alerts-unavailable">
            <h2>Could not check your account</h2>
            <p>PostGuard could not reach Buffer or the alert store just now. Nothing was changed.</p>
            <div className="cta-row">
              <Link className="button" href="/alerts/setup">Try again</Link>
            </div>
          </section>
        ) : null}

        {owner ? (
          <section className="card setup-card" data-testid="alerts-toggle">
            <h2 id="alerts-label">Email alerts</h2>
            <form action={enabled ? "/api/alerts/disable" : "/api/alerts/enable"} method="post" className="switch-row">
              <button
                type="submit"
                className="switch"
                role="switch"
                aria-checked={enabled}
                aria-labelledby="alerts-label"
                data-state={enabled ? "on" : "off"}
                disabled={!ready}
              >
                <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                <span className="switch-state">{enabled ? "On" : "Off"}</span>
              </button>
            </form>
            <p>
              {enabled
                ? "On. PostGuard sends one email a day when a queued post has a Blocker or High problem. Turning it off deletes the saved Buffer access."
                : "Off. No email is sent. Turning it on opens Buffer once to approve read-only access that the daily check keeps on the server, encrypted, while you are away."}
            </p>
            {enabled ? (
              <form action="/api/alerts/enable" method="post" className="setup-form">
                <div className="cta-row">
                  <button type="submit" className="button secondary small" disabled={!ready}>Reconnect Buffer access</button>
                </div>
              </form>
            ) : null}
            {ready ? null : (
              <p className="banner" role="note" data-testid="setup-not-ready">
                Alerts are not available on this deployment yet. The owner needs to finish the setup described in the README.
              </p>
            )}
          </section>
        ) : null}

        {/* DEMO-ONLY: remove after Buffer Commit */}
        {owner && enabled ? (
          <section className="card setup-card" data-testid="send-now">
            <h2>Send a test alert now</h2>
            <p>
              DEMO-ONLY, for the contest demo. This runs the check immediately, includes drafts, and emails you the issues it finds. It does not change the daily check or its record of what was already sent.
            </p>
            <form action="/api/alerts/send-now" method="post" className="setup-form">
              <div className="cta-row">
                <button type="submit" className="button">Send test alert now</button>
              </div>
            </form>
          </section>
        ) : null}
      </main>
    </>
  );
}
