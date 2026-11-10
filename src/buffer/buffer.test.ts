import { describe, expect, it } from "vitest";
import { BufferClient } from "./client";
import { normalizePost, readChannels, readOrganizations, readPosts } from "./normalize";
import { collectPages } from "./paginate";
import { POSTS_QUERY, UNDATED_POSTS_QUERY } from "./queries";
import { parseRateLimit, quotaLabel, shouldStopForQuota } from "./rate-limit";

describe("rate limit headers", () => {
  it("parses joined RateLimit headers and matches policies by window", () => {
    const windows = parseRateLimit(
      '"150-in-15min"; r=98; t=897, "600-in-1day"; r=2; t=86397, "3000-in-30days"; r=2969; t=696980',
      '"150-in-15min"; q=150; w=900; pk=:abc:, "600-in-1day"; q=600; w=86400, "3000-in-30days"; q=3000; w=2592000',
    );
    expect(windows.map((window) => window.remaining)).toEqual([98, 2, 2969]);
    expect(windows[0]).toMatchObject({ quota: 150, windowSeconds: 900 });
    expect(quotaLabel(windows)).toContain("15-minute: 98 of 150 left");
    expect(shouldStopForQuota(windows)).toBe(true);
    expect(shouldStopForQuota([{ ...windows[0]!, remaining: 20 }])).toBe(false);
  });
});

describe("pagination", () => {
  it("follows cursors until the server says to stop", async () => {
    const pages = [
      { items: [1, 2], hasNextPage: true, endCursor: "c1" },
      { items: [3, 4], hasNextPage: true, endCursor: "c2" },
      { items: [5], hasNextPage: false, endCursor: null },
    ];
    const seen: Array<string | null> = [];
    const result = await collectPages(async (after) => {
      seen.push(after);
      return pages[seen.length - 1]!;
    }, { maxPages: 10 });
    expect(seen).toEqual([null, "c1", "c2"]);
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.truncated).toBe(false);
  });

  it("marks the scan truncated when the page cap is hit", async () => {
    const result = await collectPages(async () => ({ items: [1], hasNextPage: true, endCursor: "next" }), { maxPages: 2 });
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(true);
  });
});

describe("GraphQL normalizer", () => {
  it("reads organizations, a channel array, and a post connection", () => {
    expect(readOrganizations({ account: { id: "acc", organizations: [{ id: "org", name: "Northwind" }] } }).organizations).toEqual([
      { id: "org", name: "Northwind" },
    ]);

    const channels = readChannels({
      channels: [
        {
          id: "ch",
          name: "northwind",
          displayName: "Northwind",
          service: "mastodon",
          isDisconnected: false,
          isLocked: true,
          isQueuePaused: false,
          timezone: "Europe/Amsterdam",
          metadata: { __typename: "MastodonMetadata", maxCharacters: 700 },
        },
      ],
    });
    expect(channels[0]).toMatchObject({ isLocked: true, maxCharacters: 700, service: "mastodon" });

    const page = readPosts({
      posts: {
        edges: [
          {
            node: {
              id: "post",
              text: "Hello",
              status: "scheduled",
              dueAt: "2026-11-12T10:00:00.000Z",
              channelId: "ch",
              channelService: "instagram",
              schedulingType: "automatic",
              error: null,
              assets: [
                {
                  __typename: "ImageAsset",
                  type: "image",
                  source: "https://cdn.example/a.jpg",
                  thumbnail: "https://cdn.example/a.jpg",
                  mimeType: "image/jpeg",
                  image: { altText: "", width: 1080, height: 1350 },
                },
              ],
              metadata: {
                __typename: "InstagramPostMetadata",
                type: "post",
                firstComment: null,
                link: "https://shop.example/grid",
                annotations: [{ type: "url", url: "https://shop.example/grid", text: "shop" }],
              },
            },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor" },
      },
    });
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe("cursor");
    expect(page.posts[0]).toMatchObject({
      hasFirstCommentField: true,
      firstComment: "",
      postType: "post",
      links: ["https://shop.example/grid"],
    });
    expect(page.posts[0]?.assets[0]).toMatchObject({ altText: "", width: 1080, height: 1350 });
  });

  it("drops a node that is missing an id and accepts a connection-shaped channel list", () => {
    expect(normalizePost({ text: "no id" })).toBeNull();
    const channels = readChannels({ channels: { edges: [{ node: { id: "ch", name: "n", service: "threads" } }] } });
    expect(channels).toHaveLength(1);
  });
});

describe("scheduled posts query", () => {
  it("pages with a cursor and asks for the fields the rules need", () => {
    expect(POSTS_QUERY).toContain("after: $after");
    expect(POSTS_QUERY).toContain("pageInfo");
    expect(POSTS_QUERY).toContain("endCursor");
    expect(POSTS_QUERY).toContain("altText");
    expect(POSTS_QUERY).toContain("firstComment");
    expect(UNDATED_POSTS_QUERY).toContain("dueAtPresence: absent");
  });
});

describe("Buffer client", () => {
  it("keeps the latest rate-limit headers and surfaces 429 and 401", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ data: { account: { id: "a" } } }), {
        status: 200,
        headers: { ratelimit: '"100-in-15min"; r=97; t=800', "ratelimit-policy": '"100-in-15min"; q=100; w=900' },
      });
    const client = new BufferClient("token", fetchImpl, "https://api.buffer.com");
    await client.query("query { account { id } }");
    expect(client.requests).toBe(1);
    expect(client.quota[0]?.remaining).toBe(97);

    const limited: typeof fetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: "Too many requests" }] }), {
        status: 429,
        headers: { "retry-after": "12" },
      });
    await expect(new BufferClient("token", limited).query("query { account { id } }")).rejects.toMatchObject({ retryAfter: 12 });

    const denied: typeof fetch = async () => new Response("{}", { status: 401 });
    await expect(new BufferClient("token", denied).query("query { account { id } }")).rejects.toThrow(/access token/i);
  });
});
