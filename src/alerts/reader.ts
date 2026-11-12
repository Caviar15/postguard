import type { ScanReport } from "@/domain/types";
import { scanLive } from "@/scan/live";
import type { QueueReader, Subscriber } from "./types";

const DAY = 24 * 3_600_000;

/** Reads the owner's queue with the same scan as the dashboard. Read-only: it only sends queries. */
export class LiveQueueReader implements QueueReader {
  constructor(
    private readonly accessTokenFor: (subscriber: Subscriber) => Promise<string>,
    private readonly run: typeof scanLive = scanLive,
  ) {}

  async scan(subscriber: Subscriber, window: { from: Date; to: Date }): Promise<ScanReport> {
    const accessToken = await this.accessTokenFor(subscriber);
    return this.run({
      accessToken,
      windowDays: (window.to.getTime() - window.from.getTime()) / DAY,
      organizationId: subscriber.organizationId || null,
      includeDrafts: false,
      now: window.from,
    });
  }
}
