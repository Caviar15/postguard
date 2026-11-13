// Preloaded after mock-buffer.cjs. Answers https://auth.buffer.com/token: it rotates refresh tokens like Buffer
// does, and revokes the whole grant when a spent token is replayed. Everything else passes through.
const fs = require("node:fs");
const previous = globalThis.fetch;
const STATE = process.env.ALERTS_AUTH_STATE || "/tmp/pg-alerts-auth.json";
const read = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { current: null, spent: [], revoked: false, counter: 0, refreshes: 0, ttl: 30 });
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith("https://auth.buffer.com/token")) return previous(input, init);
  const body = new URLSearchParams(String(init.body));
  const s = read();
  const reply = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  if (body.get("grant_type") === "authorization_code") {
    s.counter += 1;
    s.current = `RT${s.counter}`;
    fs.writeFileSync(STATE, JSON.stringify(s));
    return reply(200, { access_token: `AT${s.counter}`, refresh_token: s.current, expires_in: s.ttl, scope: "account:read posts:read offline_access" });
  }
  s.refreshes += 1;
  const token = body.get("refresh_token");
  if (s.revoked || s.spent.includes(token) || token !== s.current) {
    s.revoked = true;
    fs.writeFileSync(STATE, JSON.stringify(s));
    return reply(400, { error: "invalid_grant" });
  }
  s.spent.push(token);
  s.counter += 1;
  s.current = `RT${s.counter}`;
  fs.writeFileSync(STATE, JSON.stringify(s));
  return reply(200, { access_token: `AT${s.counter}`, refresh_token: s.current, expires_in: s.ttl, scope: "account:read posts:read offline_access" });
};
