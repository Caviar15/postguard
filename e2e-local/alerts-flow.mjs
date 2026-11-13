// End to end check of the alert flow against a production build (npm run build first):
// turn alerts on, run the cron twice, unsubscribe. Buffer, the token endpoint, Redis and the mail provider are
// local fakes, so nothing real is contacted and nothing is emailed. Run: node e2e-local/alerts-flow.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";

const PORT = 3111, REDIS_PORT = 3112, MAIL_PORT = 3113;
const CRON = "flowCronSecret0123456789abcdef";
const AUTH_STATE = "/tmp/pg-alerts-auth.json";
const SCENARIO = "/tmp/pg-alerts-flow-scenario.json";
const base = `http://127.0.0.1:${PORT}`;

// --- fake Redis (Upstash REST: POST a JSON command array) ---
const data = new Map();
const live = (k) => { const e = data.get(k); if (e && e.until !== null && e.until <= Date.now()) { data.delete(k); return undefined; } return e; };
const redisServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    if (!body) { console.log('redis fake: empty body', req.method, req.url); res.statusCode = 400; res.end('{}'); return; }
    const [name, key, ...rest] = JSON.parse(body); let result = null;
    if (name === "GET") result = live(key)?.value ?? null;
    else if (name === "DEL") result = data.delete(key) ? 1 : 0;
    else if (name === "SET") { const [value, ...f] = rest; const px = f.indexOf("PX"); if (f.includes("NX") && live(key)) result = null; else { data.set(key, { value: String(value), until: px >= 0 ? Date.now() + Number(f[px + 1]) : null }); result = "OK"; } }
    else if (name === "EVAL") { const [, lockKey, owner] = rest; if (live(lockKey)?.value === owner) { data.delete(lockKey); result = 1; } else result = 0; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ result }));
  });
}).listen(REDIS_PORT);

// --- fake mail provider ---
const mails = [];
const mailServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    mails.push({ headers: req.headers, body: JSON.parse(body) });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id: `mail_${mails.length}` }));
  });
}).listen(MAIL_PORT);

const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const node = (id, dueAt, text, channelId) => ({ id, text, status: "scheduled", dueAt, channelId, channelService: "instagram", schedulingType: "automatic", error: null, assets: [], metadata: { __typename: "InstagramPostMetadata", type: "post", firstComment: "", link: null, annotations: [] } });
const channel = (id, o = {}) => ({ id, name: id, displayName: `Studio ${id}`, service: "instagram", isDisconnected: false, isLocked: false, isQueuePaused: false, timezone: "Europe/Amsterdam", metadata: { __typename: "InstagramMetadata" }, ...o });
fs.writeFileSync(SCENARIO, JSON.stringify({
  channels: [channel("c_ok"), channel("c_paused", { isQueuePaused: true })],
  postPages: [[
    node("p_paused", hours(5), "A calm caption for the paused channel", "c_paused"),
    node("p_todo", hours(9), "TODO write the caption before this goes out", "c_ok"),
    node("p_far", hours(60), "TODO this one is days away", "c_ok"),
    node("p_fine", hours(7), "Linen drop on Friday", "c_ok"),
  ]],
}));
fs.writeFileSync(AUTH_STATE, JSON.stringify({ current: null, spent: [], revoked: false, counter: 0, refreshes: 0, ttl: 30 }));
fs.writeFileSync("/tmp/pg-alerts-flow-mock.log", "");

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: {
    ...process.env, SESSION_SECRET: "flow-session-secret-flow-session-secret", BUFFER_CLIENT_ID: "flow", BUFFER_CLIENT_SECRET: "flow",
    CRON_SECRET: CRON, KV_REST_API_URL: `http://127.0.0.1:${REDIS_PORT}`, KV_REST_API_TOKEN: "redis-flow-token",
    RESEND_API_KEY: "re_flow_key", MAIL_PROVIDER_URL: `http://127.0.0.1:${MAIL_PORT}/emails`, ALERT_EMAIL_TO: "owner@example.test",
    APP_URL: "https://postguard.example", MOCK_SCENARIO_FILE: SCENARIO, MOCK_LOG_FILE: "/tmp/pg-alerts-flow-mock.log", ALERTS_AUTH_STATE: AUTH_STATE,
    NODE_OPTIONS: "--require ./e2e-local/mock-buffer.cjs --require ./e2e-local/alerts-mocks.cjs",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = ""; server.stdout.on("data", (c) => (serverLog += c)); server.stderr.on("data", (c) => (serverLog += c));
const cleanup = () => { server.kill(); redisServer.close(); mailServer.close(); };
process.on("exit", cleanup);

const jar = new Map();
async function go(path, init = {}) {
  const res = await fetch(base + path, { redirect: "manual", ...init, headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers ?? {}) } });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const i = pair.indexOf("="); const k = pair.slice(0, i), v = pair.slice(i + 1); if (v === "") jar.delete(k); else jar.set(k, v); }
  return res;
}
const cron = (q = "") => go(`/api/cron/alerts${q}`, { headers: { authorization: `Bearer ${CRON}` } });
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj), headers: { "content-type": "application/x-www-form-urlencoded" } });

try {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/privacy`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const steps = [];
  const ok = (name) => { steps.push(name); console.log(`ok  ${name}`); };

  assert.equal((await go("/api/cron/alerts")).status, 401); ok("cron closed without the secret");
  let res = await cron("?dryRun=1"); assert.equal(res.status, 200);
  assert.equal((await res.json()).sent, 0); ok("cron with alerts off does nothing");

  const same = { origin: base };
  res = await go("/api/alerts/enable", { method: "POST" });
  assert.equal(res.status, 403); ok("a POST with no Origin is refused (CSRF guard)");
  res = await go("/api/alerts/enable", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(res.status, 403); ok("a cross-site POST is refused");
  res = await go("/api/alerts/enable", { method: "POST", headers: same });
  assert.match(res.headers.get("location"), /problem=signin/); ok("signed out: no switch, sent to sign in (no code)");
  // A normal PostGuard sign-in, returning to the alerts page. Its access token lasts an hour; the alert grant's is short on purpose.
  const setTtl = (ttl) => fs.writeFileSync(AUTH_STATE, JSON.stringify({ ...JSON.parse(fs.readFileSync(AUTH_STATE, "utf8")), ttl }));
  setTtl(3600);
  res = await go("/api/auth/start?next=%2Falerts%2Fsetup");
  let authorize = new URL(res.headers.get("location"));
  res = await go(`/api/auth/callback?code=abc&state=${authorize.searchParams.get("state")}`);
  assert.match(res.headers.get("location"), /\/alerts\/setup$/); ok("normal sign-in returns to /alerts/setup");
  setTtl(30);
  let html = await (await go("/alerts/setup")).text();
  assert.match(html, /role="switch"/); assert.match(html, /aria-checked="false"/); assert.doesNotMatch(html, /type="password"/); ok("signed-in owner sees the Off switch and no code box");
  res = await go("/api/alerts/enable", { method: "POST", headers: same });
  assert.match(res.headers.get("location"), /\/api\/auth\/start\?watch=1/);
  res = await go("/api/auth/start?watch=1");
  authorize = new URL(res.headers.get("location"));
  assert.equal(authorize.hostname, "auth.buffer.com");
  assert.equal(authorize.searchParams.get("scope"), "account:read posts:read offline_access"); ok("alert sign-in asks for the same read-only scopes");
  res = await go(`/api/auth/callback?code=abc&state=${authorize.searchParams.get("state")}`);
  assert.match(res.headers.get("location"), /alerts\/setup\?on=1/);
  assert.equal([...data.values()].some((e) => /RT2|AT2/.test(e.value)), false); ok("alerts on; stored grant is encrypted");
  html = await (await go("/alerts/setup?on=1")).text();
  assert.match(html, /aria-checked="true"/); assert.match(html, /Send test alert now/); ok("switch shows On and the demo test button appears");

  res = await cron(); assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.sent, 1, JSON.stringify(body));
  assert.equal(mails.length, 1);
  const mail = mails[0];
  assert.equal(mail.headers["idempotency-key"]?.length, 64);
  assert.match(mail.body.headers["List-Unsubscribe"], /^<https:\/\/postguard\.example\/api\/alerts\/unsubscribe\?token=/);
  assert.equal(mail.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.deepEqual(mail.body.to, ["owner@example.test"]);
  assert.match(mail.body.text, /#post-p_paused/); assert.match(mail.body.text, /#post-p_todo/);
  assert.doesNotMatch(mail.body.text, /p_far|p_fine/);
  assert.match(mail.body.text, /publish\.buffer\.com\/channels\/c_paused\?post=p_paused/);
  for (const secret of ["AT1", "AT2", "RT1", "RT2", "flow-session-secret", CRON, "re_flow_key", "redis-flow-token"]) {
    const { authorization, ...otherHeaders } = mail.headers; // the provider key legitimately travels in Authorization
    const hay = JSON.stringify(mail.body) + JSON.stringify(otherHeaders) + JSON.stringify(body);
    assert.equal(hay.includes(secret), false, `leaked ${secret}`);
  }
  ok("one email: the paused-queue post and the TODO post, not the far or the fine one; headers and deep links present; no secret in it");
  const auth1 = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8"));
  assert.equal(auth1.refreshes, 1); assert.equal(auth1.revoked, false); assert.equal(auth1.current, "RT3"); ok("expired access token refreshed once; the rotated token was saved");

  res = await cron(); body = await res.json();
  assert.equal(mails.length, 1); assert.ok(body.suppressed >= 2); ok("a second run sends nothing (already alerted)");
  const auth2 = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8"));
  assert.equal(auth2.revoked, false); assert.equal(auth2.refreshes, 2); assert.equal(auth2.current, "RT4"); ok("second refresh used the rotated token; grant still valid");

  const [concurrentA, concurrentB] = await Promise.all([cron(), cron()]);
  assert.equal(mails.length, 1); assert.equal(JSON.parse(fs.readFileSync(AUTH_STATE, "utf8")).revoked, false); ok("two overlapping runs send nothing new and do not revoke the grant");
  void concurrentA; void concurrentB;

  const token = new URL(mail.body.headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("token");
  res = await go(`/api/alerts/unsubscribe?token=${token}`); assert.equal(res.status, 200); assert.match(await res.text(), /<form method="post"/);
  res = await cron("?dryRun=1"); assert.equal((await res.json()).status, "ok"); ok("GET of the unsubscribe link changes nothing");
  res = await go(`/api/alerts/unsubscribe?token=${token}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(res.status, 200); ok("one-click POST unsubscribes");
  const before = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8")).refreshes;
  res = await cron(); body = await res.json();
  assert.equal(body.sent, 0); assert.equal(mails.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(AUTH_STATE, "utf8")).refreshes, before); ok("after unsubscribing: no run reads Buffer, no email, token deleted");
  assert.equal(fs.readFileSync("/tmp/pg-alerts-flow-mock.log", "utf8").toLowerCase().includes("mutation"), false); ok("no Buffer mutation was ever sent");
  assert.equal(serverLog.includes("RT2") || serverLog.includes("AT2") || serverLog.includes("re_flow_key"), false); ok("server log has no token");
  console.log(`\n${steps.length} checks passed`);
  cleanup(); process.exit(0);
} catch (error) {
  console.error("FAILED:", error.message);
  console.error(serverLog.split("\n").slice(-15).join("\n"));
  cleanup(); process.exit(1);
}
