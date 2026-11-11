import type { Post, ScanReport } from "@/domain/types";
import { BufferClient } from "@/buffer/client";
import { readChannels, readOrganizations, readPosts, type Organization } from "@/buffer/normalize";
import { collectPages } from "@/buffer/paginate";
import { ACCOUNT_QUERY, CHANNELS_QUERY, DRAFTS_QUERY, POSTS_QUERY, UNDATED_POSTS_QUERY } from "@/buffer/queries";
import { shouldStopForQuota } from "@/buffer/rate-limit";
import { scanStatuses } from "@/buffer/statuses";
import { assembleReport, resolveLinks } from "./assemble";

const PAGE_SIZE = 50;
const MAX_PAGES = 12;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function scanLive(input: {
  accessToken: string;
  windowDays: number;
  organizationId?: string | null;
  includeDrafts?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ScanReport> {
  const now = input.now ?? new Date();
  const includeDrafts = input.includeDrafts ?? false;
  const statuses = scanStatuses(includeDrafts);
  const client = new BufferClient(input.accessToken, input.fetchImpl);
  const notes: string[] = [
    "Character limits are the hard-coded table from Buffer's character-limits guide. The Experimental configuration query is not called.",
    "Aspect-ratio findings are best-effort. Width or height of 0 is ignored.",
  ];
  if (includeDrafts) {
    notes.push("Drafts are included, including ones with no publish time. Sent posts stay out. This is still read-only.");
  }

  const accountData = await client.query<unknown>(ACCOUNT_QUERY);
  const account = readOrganizations(accountData);
  const organization = pickOrganization(account.organizations, input.organizationId);
  if (!organization) {
    throw new Error("This Buffer account has no organization PostGuard can read.");
  }
  if (account.organizations.length > 1) {
    notes.push(`Scanning ${organization.name}. This account has ${account.organizations.length} organizations; only one is included per scan.`);
  }

  const channelData = await client.query<unknown>(CHANNELS_QUERY, { organizationId: organization.id });
  const channels = readChannels(channelData);

  const start = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const end = new Date(now.getTime() + input.windowDays * 24 * 60 * 60 * 1000).toISOString();
  let stoppedForQuota = false;

  const paged = await collectPages(
    async (after) => {
      const data = await client.query<unknown>(POSTS_QUERY, {
        organizationId: organization.id,
        first: PAGE_SIZE,
        start,
        end,
        statuses,
        ...(after ? { after } : {}),
      });
      const page = readPosts(data);
      if (shouldStopForQuota(client.quota)) stoppedForQuota = true;
      return { items: page.posts, hasNextPage: page.hasNextPage, endCursor: page.endCursor };
    },
    {
      maxPages: MAX_PAGES,
      stop: (page) => {
        if (stoppedForQuota) return true;
        if (page.items.length === 0) return false;
        return page.items.every((post) => post.dueAt !== null && post.dueAt > end);
      },
    },
  );

  let undated: Post[] = [];
  if (!stoppedForQuota && !shouldStopForQuota(client.quota)) {
    try {
      const data = await client.query<unknown>(UNDATED_POSTS_QUERY, {
        organizationId: organization.id,
        first: PAGE_SIZE,
        statuses,
      });
      const page = readPosts(data);
      undated = page.posts;
      if (page.hasNextPage) {
        notes.push("More than one page of posts has no publish time. Only the first page of those was read, to save quota.");
      }
    } catch {
      notes.push("Posts with no publish time could not be loaded. Dated posts in the window were still checked.");
    }
  }

  if (paged.truncated) {
    notes.push(`Stopped after ${paged.pages} pages (${PAGE_SIZE} requested per page). A large queue may be incomplete.`);
  }
  if (stoppedForQuota) notes.push("Stopped early because the Buffer rate-limit window is nearly empty.");

  let drafts: Post[] = [];
  if (includeDrafts && !stoppedForQuota && !shouldStopForQuota(client.quota)) {
    try {
      const data = await client.query<unknown>(DRAFTS_QUERY, {
        organizationId: organization.id,
        first: PAGE_SIZE,
      });
      const page = readPosts(data);
      drafts = page.posts;
      if (page.hasNextPage) {
        notes.push("More than 50 drafts are in this organization. The newest page was checked.");
      }
    } catch {
      notes.push("Drafts could not be loaded. Scheduled posts were still checked.");
    }
  }

  const byId = new Map<string, Post>();
  for (const post of [...paged.items, ...undated, ...drafts]) byId.set(post.id, post);
  const posts = [...byId.values()];

  const links = await resolveSafely(posts, notes);

  return assembleReport({
    posts,
    channels,
    linkResults: links.results,
    now,
    windowDays: input.windowDays,
    mode: "live",
    organization,
    quotaWindows: client.quota,
    requestsUsed: client.requests,
    cached: false,
    notes,
    skippedLinks: links.skipped,
    includeDrafts,
  });
}

function pickOrganization(organizations: Organization[], requested?: string | null): Organization | null {
  if (organizations.length === 0) return null;
  if (requested) return organizations.find((organization) => organization.id === requested) ?? organizations[0] ?? null;
  return organizations[0] ?? null;
}

async function resolveSafely(posts: Post[], notes: string[]) {
  try {
    return await resolveLinks(posts, { timeoutMs: 4_000, concurrency: 6, delayMs: 100, limit: 30 });
  } catch {
    notes.push("Link checks failed before they finished. Posts were still checked for everything that does not need HTTP.");
    return { results: new Map(), skipped: 0 };
  }
}
