export const SERVICES = [
  "instagram",
  "facebook",
  "linkedin",
  "twitter",
  "pinterest",
  "googlebusiness",
  "youtube",
  "mastodon",
  "tiktok",
  "threads",
  "bluesky",
  "substack",
  "whatsapp",
  "startPage",
] as const;

export type Service = (typeof SERVICES)[number];

export type Asset = {
  type: "image" | "video" | "document" | "other";
  source: string;
  thumbnail: string | null;
  mimeType: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
};

export type ThreadItem = {
  text: string;
};

export type Post = {
  id: string;
  text: string;
  status: string;
  dueAt: string | null;
  channelId: string;
  service: Service;
  schedulingType: "automatic" | "notification" | null;
  errorMessage: string | null;
  assets: Asset[];
  postType: string | null;
  /** Null when this network's metadata type has no firstComment field. */
  firstComment: string | null;
  hasFirstCommentField: boolean;
  /** Structured URLs that may not appear in `text` (link cards, pin destination, shop link, annotations). */
  links: string[];
  title: string | null;
  topic: string | null;
  thread: ThreadItem[];
};

export type Channel = {
  id: string;
  name: string;
  displayName: string | null;
  service: Service;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
  /** IANA zone from the channel. Null when the API omits it. */
  timezone: string | null;
  /** Mastodon server limit, when the channel metadata includes it. */
  maxCharacters: number | null;
  /** Raw TwitterMetadata.subscriptionType. The API types this as an unstructured string. */
  twitterSubscription: string | null;
};

export type LinkOutcome =
  | "ok"
  | "dead"
  | "redirect"
  | "soft-404"
  | "insecure"
  | "unverified"
  | "expiring"
  | "private-host";

export type LinkStatus = {
  url: string;
  outcome: LinkOutcome;
  status: number | null;
  hops: number;
  finalUrl: string | null;
  detail: string;
};

export type Severity = "blocker" | "high" | "medium" | "low" | "info";

export const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export type Finding = {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  postId: string | null;
  channelId: string;
  channelName: string;
  service: string;
  dueAt: string | null;
  excerpt: string | null;
  fixUrl: string;
  advisory: boolean;
};

export type QuotaWindow = {
  name: string;
  remaining: number;
  resetSeconds: number;
  quota: number | null;
  windowSeconds: number | null;
};

export type Readiness = "ready" | "attention" | "fail";

export type CropPreview = {
  src: string | null;
  width: number;
  height: number;
  label: string;
  cropped: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type PostCard = {
  id: string;
  channelId: string;
  channelName: string;
  service: string;
  status: string;
  dueAt: string | null;
  timeZone: string | null;
  excerpt: string;
  readiness: Readiness;
  fixUrl: string;
  needsAlt: boolean;
  preview: CropPreview | null;
};

export type AltSuggestion = {
  postId: string;
  altText: string;
  mismatch: string | null;
};

export type ScanReport = {
  scannedAt: string;
  windowDays: number;
  mode: "live" | "demo";
  includeDrafts: boolean;
  organization: { id: string; name: string };
  postsScanned: number;
  riskHeadline: string;
  cards: PostCard[];
  channels: Array<{
    id: string;
    name: string;
    service: string;
    isDisconnected: boolean;
    isLocked: boolean;
    isQueuePaused: boolean;
    postCount: number;
    findingCount: number;
    score: number;
    readiness: Readiness;
  }>;
  findings: Finding[];
  totals: Record<Severity, number>;
  headline: string;
  suggestions: AltSuggestion[];
  quota: {
    label: string;
    windows: QuotaWindow[];
  };
  requestsUsed: number;
  cached: boolean;
  notes: string[];
};
