/** Critical tests: rules and timeline. Drop into src/critical/rules.test.ts */
import { describe, expect, it } from "vitest";
import { duplicates } from "@/rules/duplicates";
import { hashtags } from "@/rules/hashtags";
import { placeholders } from "@/rules/placeholders";
import { runRules } from "@/rules/engine";
import { calendarDay, timelineZone } from "@/domain/timeline";
import { makeChannel, makePost } from "@/test/factory";
import type { RuleContext } from "@/rules/context";
import type { LinkStatus } from "@/domain/types";
function ctxFor(posts = [makePost()], channels = [makeChannel()], linkResults = new Map<string, LinkStatus>()): RuleContext {
  return { posts, channels, channelById: new Map(channels.map((c) => [c.id, c])), linkResults, now: new Date("2026-11-12T10:00:00Z") };
}

describe("hashtag rule", () => {
  const tagsOf = (text: string, service: "instagram" | "linkedin" = "instagram") => hashtags(ctxFor([makePost({ text, service })]));
  it("does not count a URL fragment as a hashtag", () => {
    const text = Array.from({ length: 5 }, (_, i) => `#t${i}`).join(" ") + " https://example.com/page#section";
    expect(tagsOf(text).filter((f) => f.title === "More than 5 hashtags")).toHaveLength(0);
  });
  it("does not call 'C#' or 'F#' a broken hashtag", () => {
    expect(tagsOf("We rewrote the parser in C# and F# last week").filter((f) => f.title === "Broken hashtag")).toHaveLength(0);
    expect(tagsOf("Our stack: Rust, Go and C#").filter((f) => f.title === "Broken hashtag")).toHaveLength(0);
  });
  it("still flags a real stray # and a sixth tag", () => {
    expect(tagsOf("Big news # coming soon").some((f) => f.title === "Broken hashtag")).toBe(true);
    const six = Array.from({ length: 6 }, (_, i) => `#t${i}`).join(" ");
    const over = tagsOf(six).filter((f) => f.title === "More than 5 hashtags");
    expect(over).toHaveLength(1);
    expect(over[0]?.detail).toContain("Instagram caps hashtags at 5 per caption. Buffer's composer blocks publishing above 5.");
    expect(over[0]?.detail).not.toMatch(/refuses|fail when it publishes/i);
  });
  it("flags a first comment with 8 hashtags when the caption has none, naming the first comment", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `#h${i}`).join(" ");
    const found = hashtags(ctxFor([makePost({ service: "instagram", text: "New drop", hasFirstCommentField: true, firstComment: eight })])).filter((f) => f.title === "More than 5 hashtags");
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain("8 hashtags in the first comment");
    expect(found[0]?.detail).not.toContain("in the caption");
    // exactly 5 is allowed, a URL fragment is not a tag, and a network with no first-comment field is not read
    const five = Array.from({ length: 5 }, (_, i) => `#h${i}`).join(" ");
    expect(hashtags(ctxFor([makePost({ service: "instagram", text: "x", hasFirstCommentField: true, firstComment: `${five} https://a.example/#six` })]))).toHaveLength(0);
    expect(hashtags(ctxFor([makePost({ service: "instagram", text: "x", hasFirstCommentField: false, firstComment: eight })]))).toHaveLength(0);
  });
  it("counts the caption and the first comment separately", () => {
    const six = Array.from({ length: 6 }, (_, i) => `#c${i}`).join(" ");
    const three = "#one #two #three";
    const both = hashtags(ctxFor([
      makePost({ service: "instagram", text: six, hasFirstCommentField: true, firstComment: six }),
    ]));
    expect(both.filter((f) => f.title === "More than 5 hashtags")).toHaveLength(2);
    const commentOnly = hashtags(ctxFor([
      makePost({ service: "instagram", text: "New drop", hasFirstCommentField: true, firstComment: six }),
    ]));
    expect(commentOnly.filter((f) => f.title === "More than 5 hashtags")).toHaveLength(1);
    expect(commentOnly[0]?.detail).toContain("first comment");
    const split = hashtags(ctxFor([
      makePost({ service: "instagram", text: three, hasFirstCommentField: true, firstComment: three }),
    ]));
    expect(split.filter((f) => f.title === "More than 5 hashtags")).toHaveLength(0);
    const otherNetwork = hashtags(ctxFor([
      makePost({ service: "linkedin", text: six, hasFirstCommentField: true, firstComment: six }),
    ]));
    expect(otherNetwork.filter((f) => f.title === "More than 5 hashtags")).toHaveLength(0);
  });
});

describe("placeholder rule", () => {
  const hits = (post: Partial<ReturnType<typeof makePost>>) => placeholders(ctxFor([makePost(post)]));
  it("sees a TODO that sits in the first comment", () => {
    expect(hits({ service: "instagram", hasFirstCommentField: true, firstComment: "TODO add the link", text: "Fresh drop out now." })).toHaveLength(1);
  });
  it("sees a TODO in a later post of a thread", () => {
    expect(hits({ service: "twitter", text: "Thread 1/2", thread: [{ text: "Thread 1/2" }, { text: "TBD: finish this" }] })).toHaveLength(1);
  });
  it("does not shout 'placeholder' about the ordinary word 'todo' in prose", () => {
    expect(hits({ text: "Our new todo app ships Friday" })).toHaveLength(0);
  });
  it("still catches the loud ones", () => {
    for (const text of ["TODO: write caption", "Lorem ipsum dolor", "Hi {{first_name}}", "Read more [link]", "FIXME"]) expect(hits({ text }), text).toHaveLength(1);
  });
});

describe("rule engine: one problem should be reported once", () => {
  it("a dead link in the first comment is not reported twice", () => {
    const url = "https://shop.example/gone";
    const post = makePost({ service: "instagram", hasFirstCommentField: true, firstComment: `Shop: ${url}`, text: "New drop" });
    const link: LinkStatus = { url, outcome: "dead", status: 404, hops: 0, finalUrl: url, detail: "HTTP 404." };
    const findings = runRules({ posts: [post], channels: [makeChannel({ service: "instagram" })], linkResults: new Map([[url, link]]), now: new Date("2026-11-12T10:00:00Z") });
    const about = findings.filter((f) => f.detail.includes(url));
    expect(about).toHaveLength(1);
  });
});

describe("duplicates", () => {
  it("two posts that differ only in their link are not 'The text matches' duplicates", () => {
    const a = makePost({ id: "a", text: "New episode is out now! Listen here: https://pod.example/ep-41", dueAt: "2026-11-12T09:00:00Z" });
    const b = makePost({ id: "b", text: "New episode is out now! Listen here: https://pod.example/ep-42", dueAt: "2026-11-12T20:00:00Z" });
    expect(duplicates(ctxFor([a, b]))).toHaveLength(0);
  });
  it("same text on the same channel 23h apart is flagged (positive control)", () => {
    const text = "The linen series is back in the studio this week. Same cloth, new dye lot.";
    const a = makePost({ id: "a", text, dueAt: "2026-11-12T09:00:00Z" });
    const b = makePost({ id: "b", text, dueAt: "2026-11-13T08:00:00Z" });
    expect(duplicates(ctxFor([a, b]))).toHaveLength(1);
  });
  it("700 ordinary posts (60 words) stay interactive (the live scan cap is ~700 posts)", () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`);
    const posts = Array.from({ length: 700 }, (_, i) => makePost({ id: `p${i}`, text: words.map((w, j) => (j % 7 === i % 7 ? `${w}x${i}` : w)).join(" "), dueAt: "2026-11-12T10:00:00Z" }));
    const t0 = Date.now();
    duplicates(ctxFor(posts));
    // URLs are extracted once per post. The pairwise loop is still O(n²), and this budget is the CI ceiling.
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it("700 long posts that each carry a different link stay fast (URLs are extracted once per post, not once per pair)", () => {
    const posts = Array.from({ length: 700 }, (_, i) => makePost({ id: `p${i}`, text: ("Long caption with many words about the studio https://shop.example/p/" + i + " ").repeat(30) + ` n${i}`, dueAt: "2026-11-12T10:00:00Z" }));
    const t0 = Date.now();
    duplicates(ctxFor(posts));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("timeline", () => {
  it("an unknown timezone from the API degrades to UTC instead of throwing", () => {
    const z = timelineZone(["Mars/Olympus_Mons", "Mars/Olympus_Mons"]);
    expect(() => calendarDay("2026-11-12T10:00:00Z", z.zone)).not.toThrow();
  });
  it("assigns a 23:30 Amsterdam post to the right local day across the DST change", () => {
    expect(calendarDay("2026-10-24T22:30:00Z", "Europe/Amsterdam")).toBe("2026-10-25");
    expect(calendarDay("2026-10-25T23:30:00Z", "Europe/Amsterdam")).toBe("2026-10-26");
    expect(calendarDay("2026-11-12T23:30:00Z", "America/Los_Angeles")).toBe("2026-11-12");
  });
});
