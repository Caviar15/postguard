// Preloaded with NODE_OPTIONS=--require. Answers https://api.buffer.com from a scenario file; everything else passes through.
const fs = require("node:fs");
const real = globalThis.fetch;
const SCENARIO = process.env.MOCK_SCENARIO_FILE || "/tmp/pg-scenario.json";
const LOG = process.env.MOCK_LOG_FILE || "/tmp/pg-mock.log";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith("https://api.buffer.com")) return real(input, init);
  const body = JSON.parse(init.body);
  const name = /query\s+(\w+)/.exec(body.query)?.[1] ?? "unknown";
  const sc = JSON.parse(fs.readFileSync(SCENARIO, "utf8"));
  fs.appendFileSync(LOG, `${Date.now()} ${name} ${JSON.stringify(body.variables ?? {}).slice(0, 200)}\n`);
  const h = { "content-type": "application/json", ratelimit: '"15min";r=90;t=800, "24h";r=400;t=80000', "ratelimit-policy": '"15min";q=100;w=900, "24h";q=500;w=86400' };
  const handler = sc[name];
  if (handler?.status) return new Response(JSON.stringify(handler.body ?? { errors: [{ message: "scenario error" }] }), { status: handler.status, headers: { ...h, ...(handler.noRetryAfter ? {} : { "retry-after": "60" }) } });
  if (name === "PostGuardPosts") {
    const pages = sc.postPages ?? [[]];
    const after = body.variables.after ? Number(body.variables.after) : 0;
    const page = pages[after] ?? [];
    return new Response(JSON.stringify({ data: { posts: { edges: page.map((node) => ({ node })), pageInfo: { hasNextPage: after + 1 < pages.length, endCursor: String(after + 1) } } } }), { headers: h });
  }
  if (name === "PostGuardUndatedPosts") return new Response(JSON.stringify({ data: { posts: { edges: (sc.undated ?? []).map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } } }), { headers: h });
  if (name === "PostGuardDrafts") return new Response(JSON.stringify({ data: { posts: { edges: (sc.drafts ?? []).map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } } }), { headers: h });
  if (name === "PostGuardAccount") return new Response(JSON.stringify({ data: { account: { id: "a1", organizations: sc.orgs ?? [{ id: "o1", name: "Test Org" }] } } }), { headers: h });
  if (name === "PostGuardChannels") return new Response(JSON.stringify({ data: { channels: sc.channels ?? [] } }), { headers: h });
  return new Response(JSON.stringify({ errors: [{ message: "unmocked " + name }] }), { status: 400, headers: h });
};
