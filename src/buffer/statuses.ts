/**
 * `PostStatus` from the Buffer reference (fetched 10 Nov 2026, still the
 * published enum): draft, error, needs_approval, scheduled, sending, sent.
 * `sent` is the only state that has already published.
 */
export const POST_STATUSES = ["draft", "error", "needs_approval", "scheduled", "sending", "sent"] as const;

export type PostStatusName = (typeof POST_STATUSES)[number];

/** What a scan looks at unless the reader opts into drafts. */
export const QUEUE_STATUSES = ["scheduled", "error", "needs_approval"] as const;

/**
 * Drafts, plus posts Buffer is in the middle of sending. Still read-only:
 * nothing here is a write, and `sent` stays out.
 */
export const WITH_DRAFT_STATUSES = ["draft", "sending", "scheduled", "error", "needs_approval"] as const;

export function scanStatuses(includeDrafts: boolean): string[] {
  return includeDrafts ? [...WITH_DRAFT_STATUSES] : [...QUEUE_STATUSES];
}
