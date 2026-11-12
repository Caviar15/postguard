/** Critical tests: unreadable posts are counted, not silently dropped. Drop into src/critical/normalize.test.ts */
import { describe, expect, it } from "vitest";
import { readPosts } from "@/buffer/normalize";

describe("readPosts", () => {
  it("counts nodes it cannot read instead of hiding them", () => {
    const good = { id: "p1", text: "hi", channelId: "c1", status: "scheduled" };
    const data = { posts: { edges: [{ node: good }, { node: { id: "p2", text: null, channelId: "c1" } }, { node: "garbage" }, { node: { text: "no id", channelId: "c1" } }], pageInfo: {} } };
    const out = readPosts(data);
    expect(out.posts.map((p) => p.id)).toEqual(["p1"]);
    expect(out.skipped).toBe(3);
  });
  it("survives hostile shapes", () => {
    for (const data of [null, undefined, 5, "x", [], { posts: null }, { posts: { edges: "no" } }, { posts: { edges: [null, 1, {}] } }]) {
      expect(() => readPosts(data)).not.toThrow();
    }
  });
});
