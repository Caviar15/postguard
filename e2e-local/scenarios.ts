export const channel = (o: Record<string, unknown> = {}) => ({ id: "c1", name: "kock", displayName: "Kock IG", service: "instagram", isDisconnected: false, isLocked: false, isQueuePaused: false, timezone: "Europe/Amsterdam", metadata: { __typename: "InstagramMetadata" }, ...o });
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
export const post = (i: number, o: Record<string, unknown> = {}) => ({ id: `p${i}`, text: `Post number ${i} about linen and dye lots for the studio`, status: "scheduled", dueAt: inHours(2 + (i % 150)), channelId: "c1", channelService: "instagram", schedulingType: "automatic", error: null, assets: [] as unknown[], metadata: { __typename: "InstagramPostMetadata", type: "post", firstComment: "", link: null, annotations: [] }, ...o });
const img = (w: number, h: number, alt: string | null) => ({ __typename: "ImageAsset", mimeType: "image/jpeg", source: "https://cdn.example/a.jpg", thumbnail: null, type: "image", image: { altText: alt, width: w, height: h } });
export const scenarios = {
  normal: { channels: [channel()], postPages: [[post(1), post(2, { assets: [img(1080, 1350, null)] }), post(3, { text: "TODO write caption" })]] },
  empty: { channels: [channel()], postPages: [[]] },
  huge: { channels: [channel()], postPages: Array.from({ length: 14 }, (_, p) => Array.from({ length: 50 }, (_, i) => post(p * 50 + i, { text: ("Long caption with many words about the studio. ").repeat(60) + ` #${p}-${i}` }))) },
  badTimezone: { channels: [channel({ timezone: "Not/AZone" })], postPages: [[post(1)]] },
  rateLimited: { channels: [channel()], PostGuardPosts: { status: 429, body: { errors: [{ message: "Too many requests" }] } } },
  rateLimitedNoHeader: { channels: [channel()], PostGuardPosts: { status: 429, noRetryAfter: true, body: { errors: [{ message: "Too many requests" }] } } },
  firstCommentTags: { channels: [channel()], postPages: [[post(1, { text: "New drop", metadata: { __typename: "InstagramPostMetadata", type: "post", firstComment: Array.from({ length: 8 }, (_, i) => `#tag${i}`).join(" "), link: null, annotations: [] } })]] },
  authRejected: { PostGuardAccount: { status: 401, body: { errors: [{ message: "bad token" }] } } },
  nullText: { channels: [channel()], postPages: [[post(1), { ...post(2), text: null }, post(3, { channelService: "mysteryservice" })]] },
  noDimensions: { channels: [channel()], postPages: [[post(1, { assets: [img(0, 0, null)] })]] },
  twoOrgs: { orgs: [{ id: "o1", name: "Org One" }, { id: "o2", name: "Org Two" }], channels: [channel()], postPages: [[post(1)]] },
  lockedChannel: { channels: [channel({ isLocked: true })], postPages: [[post(1)]] },
  oldError: { channels: [channel()], postPages: [[]], undated: [], drafts: [] },
};
