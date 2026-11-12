import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { buildAlert } from "@/alerts/build";
import { buildDemoReport } from "@/demo/build";
import { DEMO_PLATFORMS, parseDemoPlatform, platformLabel, type DemoPlatform } from "@/demo/platforms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert email preview · PostGuard" };

export default async function DemoAlertPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const params = await searchParams;
  const platform = parseDemoPlatform(params.platform);
  const report = await buildDemoReport(new Date(), 7, false, platform);
  const demoHref = (next: DemoPlatform) => (next === "all" ? "/demo" : `/demo?platform=${next}`);
  const alertHref = (next: DemoPlatform) => (next === "all" ? "/demo/alert" : `/demo/alert?platform=${next}`);
  const alert = buildAlert(report, {
    dashboardUrl: demoHref(platform),
    previewLabel: "Preview with sample data. This is the Northwind Studio demo queue, not a real account, and nothing was sent.",
  });

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
          Once a day PostGuard checks the next 7 days of your Buffer queue. If nothing is wrong, you hear nothing. If a Blocker or High problem turns up, you get one email like this.
        </p>
        <nav className="platforms" aria-label="Example queue">
          {DEMO_PLATFORMS.map((item) => (
            <Link key={item} href={alertHref(item)} aria-current={item === platform ? "page" : undefined}>
              {platformLabel(item)}
            </Link>
          ))}
        </nav>

        {alert ? (
          <section className="email-frame" aria-label="Alert email preview" data-testid="alert-preview">
            <dl className="email-head">
              <div><dt>From</dt><dd>PostGuard &lt;onboarding@resend.dev&gt;</dd></div>
              <div><dt>To</dt><dd>you</dd></div>
              <div><dt>Subject</dt><dd data-testid="alert-subject">{alert.subject}</dd></div>
            </dl>
            <div className="email-body" data-testid="alert-body" dangerouslySetInnerHTML={{ __html: alert.html }} />
          </section>
        ) : (
          <section className="card" data-testid="alert-empty">
            <h2>No email would be sent.</h2>
            <p>This example queue has no Blocker or High problems in the next 7 days, so PostGuard stays quiet.</p>
          </section>
        )}

        <p className="fine alert-foot">
          Sent through Resend, daily at 06:00 UTC. Read-only toward Buffer. <Link href="/alerts/setup">Set this up for your own account</Link>.
        </p>
      </main>
    </>
  );
}
