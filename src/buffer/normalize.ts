import type { Asset, Channel, Post, Service } from "@/domain/types";
import { SERVICES } from "@/domain/types";
import { isHttpUrl } from "@/domain/urls";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asService(value: unknown): Service {
  if (typeof value === "string" && (SERVICES as readonly string[]).includes(value)) return value as Service;
  return "startPage";
}

function annotationUrls(metadata: Record<string, unknown>): string[] {
  const annotations = metadata.annotations;
  if (!Array.isArray(annotations)) return [];
  const urls: string[] = [];
  for (const annotation of annotations) {
    if (!isRecord(annotation)) continue;
    const url = asString(annotation.url);
    if (url && isHttpUrl(url)) urls.push(url);
  }
  return urls;
}

function attachmentUrls(metadata: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const attachment = isRecord(metadata.linkAttachment) ? metadata.linkAttachment : null;
  if (attachment) {
    for (const key of ["expandedUrl", "url"] as const) {
      const url = asString(attachment[key]);
      if (url && isHttpUrl(url)) urls.push(url);
    }
  }
  for (const key of ["link", "url"] as const) {
    const url = asString(metadata[key]);
    if (url && isHttpUrl(url) && key === "link") urls.push(url);
    if (key === "url" && url && isHttpUrl(url) && metadata.__typename === "PinterestPostMetadata") urls.push(url);
  }
  return urls;
}

function readThread(metadata: Record<string, unknown>): { text: string }[] {
  if (!Array.isArray(metadata.thread)) return [];
  return metadata.thread.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = asString(item.text);
    return text === null ? [] : [{ text }];
  });
}

const FIRST_COMMENT_TYPES = new Set([
  "InstagramPostMetadata",
  "FacebookPostMetadata",
  "LinkedInPostMetadata",
]);

function readAsset(value: unknown): Asset | null {
  if (!isRecord(value)) return null;
  const source = asString(value.source) ?? "";
  const typename = asString(value.__typename) ?? "";
  const declared = asString(value.type);
  let type: Asset["type"] = "other";
  if (typename === "ImageAsset" || declared === "image") type = "image";
  else if (typename === "VideoAsset" || declared === "video") type = "video";
  else if (typename === "DocumentAsset" || declared === "document") type = "document";

  const image = isRecord(value.image) ? value.image : null;
  const video = isRecord(value.video) ? value.video : null;
  const dimensions = image ?? video;
  return {
    type,
    source,
    thumbnail: asString(value.thumbnail),
    mimeType: asString(value.mimeType),
    altText: type === "image" ? asString(image?.altText) : null,
    width: asNumber(dimensions?.width),
    height: asNumber(dimensions?.height),
  };
}

export function normalizePost(node: unknown): Post | null {
  if (!isRecord(node)) return null;
  const id = asString(node.id);
  const text = asString(node.text);
  const channelId = asString(node.channelId);
  if (!id || text === null || !channelId) return null;

  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const typename = asString(metadata.__typename) ?? "";
  const scheduling = asString(node.schedulingType);
  const error = isRecord(node.error) ? asString(node.error.message) : null;
  const assets = Array.isArray(node.assets) ? node.assets.flatMap((asset) => {
    const normalized = readAsset(asset);
    return normalized ? [normalized] : [];
  }) : [];

  const links = [...new Set([...attachmentUrls(metadata), ...annotationUrls(metadata)])];
  const hasFirstCommentField = FIRST_COMMENT_TYPES.has(typename);

  return {
    id,
    text,
    status: asString(node.status) ?? "scheduled",
    dueAt: asString(node.dueAt),
    channelId,
    service: asService(node.channelService),
    schedulingType: scheduling === "automatic" || scheduling === "notification" ? scheduling : null,
    errorMessage: error,
    assets,
    postType: asString(metadata.type),
    firstComment: hasFirstCommentField ? (asString(metadata.firstComment) ?? "") : null,
    hasFirstCommentField,
    links,
    title: asString(metadata.title),
    topic: asString(metadata.topic),
    thread: readThread(metadata),
  };
}

export function normalizeChannel(node: unknown): Channel | null {
  if (!isRecord(node)) return null;
  const id = asString(node.id);
  const name = asString(node.name);
  if (!id || !name) return null;
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  return {
    id,
    name,
    displayName: asString(node.displayName),
    service: asService(node.service),
    isDisconnected: asBoolean(node.isDisconnected),
    isLocked: asBoolean(node.isLocked),
    isQueuePaused: asBoolean(node.isQueuePaused),
    timezone: asString(node.timezone) ?? "UTC",
    maxCharacters: asNumber(metadata.maxCharacters),
    twitterSubscription: asString(metadata.subscriptionType),
  };
}

export type Organization = { id: string; name: string };

export function readOrganizations(data: unknown): { accountId: string | null; organizations: Organization[] } {
  const root = isRecord(data) ? data : {};
  const account = isRecord(root.account) ? root.account : {};
  const organizations = Array.isArray(account.organizations) ? account.organizations : [];
  return {
    accountId: asString(account.id),
    organizations: organizations.flatMap((org) => {
      if (!isRecord(org) || typeof org.id !== "string") return [];
      return [{ id: org.id, name: typeof org.name === "string" ? org.name : "Organization" }];
    }),
  };
}

function nodesFromConnection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.edges)) {
    return value.edges.flatMap((edge) => {
      if (!isRecord(edge)) return [];
      return edge.node === undefined ? [] : [edge.node];
    });
  }
  return [];
}

export function readChannels(data: unknown): Channel[] {
  const root = isRecord(data) ? data : {};
  return nodesFromConnection(root.channels).flatMap((node) => {
    const channel = normalizeChannel(node);
    return channel ? [channel] : [];
  });
}

export function readPosts(data: unknown): { posts: Post[]; hasNextPage: boolean; endCursor: string | null } {
  const root = isRecord(data) ? data : {};
  const connection = root.posts;
  const pageInfo = isRecord(connection) && isRecord(connection.pageInfo) ? connection.pageInfo : {};
  return {
    posts: nodesFromConnection(connection).flatMap((node) => {
      const post = normalizePost(node);
      return post ? [post] : [];
    }),
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: asString(pageInfo.endCursor),
  };
}
