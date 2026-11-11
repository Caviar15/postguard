import { describe, expect, it } from "vitest";
import { headline } from "@/domain/headline";
import { buildDemoReport } from "@/demo/build";
import { scanLive } from "./live";

describe("demo report", () => {
  it("tells the queue-health story the landing page promises", async () => {
    const report = await buildDemoReport(new Date("2026-11-10T12:00:00.000Z"), 7);
    expect(report.mode).toBe("demo");
    expect(report.requestsUsed).toBe(0);
    expect(report.headline).toBe("Next 7 days: 3 dead links, 1 duplicate, 2 missing alt text, 1 paused channel, 7 other risks.");
    expect(report.riskHeadline).toBe("A risky post is already overdue.");
    expect(report.includeDrafts).toBe(false);
    expect(report.cards.some((card) => card.preview?.cropped)).toBe(true);
    const withDrafts = await buildDemoReport(new Date("2026-11-10T12:00:00.000Z"), 7, true);
    expect(withDrafts.cards.some((card) => card.status === "draft")).toBe(true);
    expect(withDrafts.findings.some((finding) => finding.postId === "post_ig_draft")).toBe(true);
    expect(report.findings.every((finding) => finding.fixUrl.startsWith("https://publish.buffer.com/channels/"))).toBe(true);
    expect(headline(report.findings, 7)).toBe(report.headline);
  });
});

describe("live scan", () => {
  it("pages the posts query and stops before spending a near-empty quota", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables?: { after?: string | null } };
      calls.push(body.query);
      const headers = { ratelimit: '"100-in-15min"; r=40; t=400', "ratelimit-policy": '"100-in-15min"; q=100; w=900' };
      if (body.query.includes("PostGuardAccount")) {
        return Response.json({ data: { account: { id: "acc", organizations: [{ id: "org", name: "Northwind" }] } } }, { headers });
      }
      if (body.query.includes("PostGuardChannels")) {
        return Response.json({
          data: {
            channels: [
              { id: "ch", name: "northwind", displayName: "Northwind", service: "instagram", isDisconnected: false, isLocked: false, isQueuePaused: false, timezone: "UTC", metadata: null },
            ],
          },
        }, { headers });
      }
      if (body.query.includes("PostGuardUndatedPosts")) {
        return Response.json({ data: { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }, { headers });
      }
      const after = body.variables?.after ?? null;
      const node = (id: string) => ({
        id,
        text: "Studio hours this Thursday.",
        status: "scheduled",
        dueAt: "2026-11-12T10:00:00.000Z",
        channelId: "ch",
        channelService: "instagram",
        schedulingType: "automatic",
        error: null,
        assets: [],
        metadata: { __typename: "InstagramPostMetadata", type: "post", firstComment: "", link: null, annotations: [] },
      });
      if (!after) {
        return Response.json({
          data: { posts: { edges: [{ node: node("p1") }], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
        }, { headers });
      }
      return Response.json({
        data: { posts: { edges: [{ node: node("p2") }], pageInfo: { hasNextPage: false, endCursor: null } } },
      }, { headers });
    };

    const report = await scanLive({
      accessToken: "token",
      windowDays: 7,
      fetchImpl,
      now: new Date("2026-11-10T12:00:00.000Z"),
    });
    expect(report.postsScanned).toBe(2);
    expect(report.requestsUsed).toBe(5);
    expect(calls.filter((query) => query.includes("query PostGuardPosts("))).toHaveLength(2);
    expect(report.quota.windows[0]?.remaining).toBe(40);
    expect(calls.some((query) => query.includes("after: $after"))).toBe(true);
  });
});
