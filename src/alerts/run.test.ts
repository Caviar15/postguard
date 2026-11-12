import { describe, expect, it, vi } from "vitest";
import { buildDemoReport } from "@/demo/build";
import type { ScanReport } from "@/domain/types";
import { isAuthorised, runCheck } from "./run";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const SECRET = "cron-secret-for-tests";
const ENV = { CRON_SECRET: SECRET, RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "me@example.com" };

function req(path = "", auth: string | null = `Bearer ${SECRET}`): Request {
  return new Request(`https://postguard.test/api/cron/check${path}`, { headers: auth ? { authorization: auth } : {} });
}

async function demo(): Promise<ScanReport> {
  return buildDemoReport(NOW, 7);
}

async function quiet(): Promise<ScanReport> {
  const report = await demo();
  return { ...report, findings: report.findings.filter((item) => item.severity !== "blocker" && item.severity !== "high") };
}

describe("/api/cron/check auth", () => {
  it("rejects a request with no Authorization header", async () => {
    const getReport = vi.fn(demo);
    const result = await runCheck(req("", null), { env: ENV, getReport });
    expect(result.status).toBe(401);
    expect(getReport).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret, a bare secret and a prefix of the right one", async () => {
    for (const header of ["Bearer nope", SECRET, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`, `Bearer ${SECRET}x`]) {
      expect((await runCheck(req("", header), { env: ENV, getReport: demo })).status, header).toBe(401);
    }
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    expect(isAuthorised(req("", "Bearer "), {})).toBe(false);
    expect(isAuthorised(req("", "Bearer undefined"), {})).toBe(false);
    expect((await runCheck(req("", "Bearer "), { env: {}, getReport: demo })).status).toBe(401);
  });

  it("does not send anything for an unauthorised request, even with mail configured", async () => {
    const fetchImpl = vi.fn();
    await runCheck(req("", "Bearer wrong"), { env: ENV, getReport: demo, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("/api/cron/check run", () => {
  it("sends nothing when there are no Blocker or High findings", async () => {
    const fetchImpl = vi.fn();
    const result = await runCheck(req(), { env: ENV, getReport: quiet, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, sent: false, reason: "nothing_to_report", riskyPosts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends ONE email through Resend when Blocker or High findings exist", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const result = await runCheck(req(), { env: ENV, getReport: demo, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.body).toMatchObject({ ok: true, sent: true, emailId: "email_1" });
    expect(result.body.riskyPosts).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const sent = JSON.parse(String(init.body));
    expect(sent.to).toEqual(["me@example.com"]);
    expect(sent.from).toBe("PostGuard <onboarding@resend.dev>");
    expect(sent.html).toContain("Fix in Buffer");
    expect(sent.html).toContain("https://postguard.test/dashboard");
    expect(JSON.stringify(result.body)).not.toContain("re_test");
  });

  it("dryRun returns the rendered email and does not send", async () => {
    const fetchImpl = vi.fn();
    const result = await runCheck(req("?dryRun=1"), { env: ENV, getReport: demo, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.body).toMatchObject({ sent: false, reason: "dry_run" });
    const email = result.body.email as { subject: string; html: string; text: string };
    expect(email.subject).toContain("PostGuard");
    expect(email.html).toContain("Fix in Buffer");
    expect(email.text).toContain("Open PostGuard");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the dry-run output and sent:false with a reason when email env is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await runCheck(req(), { env: { CRON_SECRET: SECRET }, getReport: demo, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.status).toBe(200);
    expect(result.body.sent).toBe(false);
    expect(String(result.body.reason)).toContain("RESEND_API_KEY");
    expect(String(result.body.reason)).toContain("ALERT_EMAIL_TO");
    expect((result.body.email as { html: string }).html).toContain("Fix in Buffer");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a Resend failure as an error, not as sent", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    const result = await runCheck(req(), { env: ENV, getReport: demo, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ ok: false, sent: false });
  });

  it("says so when Buffer credentials are not configured, without leaking anything", async () => {
    const result = await runCheck(req(), { env: ENV, store: null });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("source=demo runs the same pipeline on the demo queue without Buffer credentials", async () => {
    const result = await runCheck(req("?source=demo&dryRun=1&platform=x"), { env: ENV, now: NOW });
    expect(result.body).toMatchObject({ ok: true, source: "demo", sent: false });
  });
});
