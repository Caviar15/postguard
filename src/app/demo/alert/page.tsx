import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { renderMessage } from "@/alerts/message";
import { horizonFor, selectAlertItems } from "@/alerts/select";
import type { Subscriber } from "@/alerts/types";
import { buildDemoReport } from "@/demo/build";
import { DEMO_PLATFORMS, parseDemoPlatform, platformLabel, type DemoPlatform } from "@/demo/platforms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert email preview · PostGuard" };

const APP_URL = "https://postguard-rho.vercel.app";
const CONFIG = { cadenceHours: 24, jitterHours: 1, leadHours: 2 };

/** A made-up recipient for the preview. Nothing here is a real account, token or address. */
const PREVIEW_SUBSCRIBER: Subscriber = {
  id: "preview",
  email: "you@example.com",
  organizationId: "",
  timeZone: "Europe/Amsterdam",
  unsubscribed: false,
  unsubscribeToken: "preview-link-not-a-real-token",
  credentials: { accessToken: "", refreshToken: null, expiresAt: 0 },
};

export default async function DemoAlertPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const params = await searchParams;
  const platform = parseDemoPlatform(params.platform);
  const now = new Date();
  const report = await buildDemoReport(now, 7, false, platform);
  const demoHref = (next: DemoPlatform) => (next === "all" ? "/demo" : `/demo?platform=${next}`);
  const alertHref = (next: DemoPlatform) => (next === "all" ? "/demo/alert" : `/demo/alert?platform=${next}`);
  const items = selectAlertItems(report, PREVIEW_SUBSCRIBER, { now, horizonEnd: horizonFor(CONFIG, now), appUrl: APP_URL });
  const message =
    items.length > 0
      ? renderMessage(items, PREVIEW_SUBSCRIBER, {
          now,
          appUrl: APP_URL,
          report,
          hoursAhead: 27,
          previewLabel: "Preview with sample data. This is the Northwind Studio demo queue, not a real account, and nothing was sent.",
        })
      : null;

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <Link className="button secondary small" href={demoHref(platform)}>Back to the demo queue</Link>
        </div>
        <p className="proof">Read-only · sample data, not a live queue</p>
      </header>
      <main id="main" className="wrap">
        <p className="kicker">Alert email · preview</p>
        <h1>It comes to you.</h1>
        <p className="lede">
          Once a day PostGuard checks the posts that will publish in roughly the next 27 hours. If nothing is wrong, you hear nothing. If a Blocker or High problem turns up, you get one email like this.
        </p>
        <nav className="platforms" aria-label="Example queue">
          {DEMO_PLATFORMS.map((item) => (
            <Link key={item} href={alertHref(item)} aria-current={item === platform ? "page" : undefined}>
              {platformLabel(item)}
            </Link>
          ))}
        </nav>

        {message ? (
          <section className="email-frame" aria-label="Alert email preview" data-testid="alert-preview">
            <dl className="email-head">
              <div><dt>From</dt><dd>PostGuard &lt;onboarding@resend.dev&gt;</dd></div>
              <div><dt>To</dt><dd>you@example.com</dd></div>
              <div><dt>Subject</dt><dd data-testid="alert-subject">{message.subject}</dd></div>
            </dl>
            <div className="email-body" data-testid="alert-body" dangerouslySetInnerHTML={{ __html: message.html }} />
          </section>
        ) : (
          <section className="card" data-testid="alert-empty">
            <h2>No email would be sent.</h2>
            <p>This example queue has no Blocker or High problem on a post publishing in the next 27 hours, so PostGuard stays quiet.</p>
          </section>
        )}

        <p className="fine alert-foot">
          Sent through Resend once a day in the early morning (the 06:00 UTC hour, 07:00 to 09:00 in Amsterdam). Read-only toward Buffer. <Link href="/alerts/setup">Set this up for your own account</Link>.
        </p>
      </main>
    </>
  );
}
