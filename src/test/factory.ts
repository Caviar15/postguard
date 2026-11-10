import type { Channel, LinkStatus, Post } from "@/domain/types";

export function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "c1",
    name: "northwind",
    displayName: "Northwind",
    service: "linkedin",
    isDisconnected: false,
    isLocked: false,
    isQueuePaused: false,
    timezone: "Europe/Amsterdam",
    maxCharacters: null,
    twitterSubscription: null,
    ...overrides,
  };
}

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    text: "Hello from the studio",
    status: "scheduled",
    dueAt: "2026-11-12T15:00:00.000Z",
    channelId: "c1",
    service: "linkedin",
    schedulingType: "automatic",
    errorMessage: null,
    assets: [],
    postType: "post",
    firstComment: null,
    hasFirstCommentField: false,
    links: [],
    title: null,
    topic: null,
    thread: [],
    ...overrides,
  };
}

export function link(url: string, outcome: LinkStatus["outcome"], extra: Partial<LinkStatus> = {}): LinkStatus {
  return {
    url,
    outcome,
    status: outcome === "dead" ? 404 : outcome === "ok" ? 200 : null,
    hops: 0,
    finalUrl: url,
    detail: extra.detail ?? outcome,
    ...extra,
  };
}
