import type { ScanReport } from "@/domain/types";

export type Subscriber = {
  id: string;
  email: string;
  organizationId: string;
  /** IANA zone. Null means times are labelled UTC. */
  timeZone: string | null;
  unsubscribed: boolean;
  /** Opaque token used only in the unsubscribe URL. */
  unsubscribeToken: string;
  /** Server-side Buffer credentials. Never put these in messages, logs or URLs. */
  credentials: { accessToken: string; refreshToken: string | null; expiresAt: number };
};

export type AlertItem = {
  /** Dedupe key: subscriber + post + finding. */
  key: string;
  postId: string;
  channelId: string;
  channelName: string;
  service: string;
  ruleId: string;
  severity: "blocker" | "high";
  dueAt: string;
  title: string;
  detail: string;
  excerpt: string | null;
  /** Buffer link to the exact post. */
  fixUrl: string;
  /** PostGuard dashboard link to the exact card (`#post-<id>`). */
  cardUrl: string;
};

export type OutgoingMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Includes List-Unsubscribe and List-Unsubscribe-Post (RFC 8058). */
  headers: Record<string, string>;
};

export interface Mailer {
  /** The idempotency key is stable for the same subscriber and the same set of item keys. */
  send(message: OutgoingMessage, options: { idempotencyKey: string }): Promise<{ id: string }>;
}

/** Read-only view of a subscriber's Buffer queue. */
export interface QueueReader {
  scan(subscriber: Subscriber, window: { from: Date; to: Date }): Promise<ScanReport>;
}

export type Release = () => Promise<void>;

export interface AlertStore {
  listSubscribers(): Promise<Subscriber[]>;
  /** Distributed lock. Null when another run holds it. */
  acquireLock(name: string, ttlMs: number): Promise<Release | null>;
  /** Atomic claim of a dedupe key (SET NX). False when already claimed. */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Undo a claim when the send did not happen, so a later run can retry. */
  unclaim(key: string): Promise<void>;
  getLastSuccess(subscriberId: string): Promise<string | null>;
  setLastSuccess(subscriberId: string, iso: string): Promise<void>;
  /** Marks the subscriber unsubscribed and deletes the stored Buffer token. False for an unknown token. */
  unsubscribe(token: string): Promise<boolean>;
}

export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export type AlertConfig = {
  /** Public origin, for example https://postguard-rho.vercel.app. */
  appUrl: string;
  /** Hours between scheduled runs. Vercel Hobby: 24. */
  cadenceHours: number;
  /** A Hobby cron can fire anywhere within its hour. */
  jitterHours: number;
  /** Extra warning time before a post publishes. */
  leadHours: number;
};

export type RunDeps = {
  store: AlertStore;
  mailer: Mailer;
  reader: QueueReader;
  now: () => Date;
  log: Logger;
  config: AlertConfig;
  sleep: (ms: number) => Promise<void>;
  env: Record<string, string | undefined>;
};

export type RunResult = {
  status: "ok" | "partial" | "failed" | "skipped-locked";
  sent: number;
  /** Items not sent because they were already alerted. */
  suppressed: number;
  errors: string[];
  /** Largest Retry-After seen, in seconds. */
  retryAfterSeconds?: number;
  /** Only with dryRun: the messages that would have been sent. */
  previews?: Array<Pick<OutgoingMessage, "subject" | "text" | "html">>;
};
