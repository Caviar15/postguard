function urlPattern(): RegExp {
  return /https?:\/\/[^\s<>"')\]]+/gi;
}

export function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,!?;:)]+$/g, "");
}

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const match of text.matchAll(urlPattern())) {
    const url = stripTrailingPunctuation(match[0]);
    if (url) found.push(url);
  }
  return found;
}

export function unique(urls: string[]): string[] {
  return [...new Set(urls)];
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function copyUrls(post: {
  text: string;
  firstComment: string | null;
  links: string[];
  thread: { text: string }[];
}): string[] {
  return unique([
    ...extractUrls(post.text),
    ...extractUrls(post.firstComment),
    ...post.thread.flatMap((item) => extractUrls(item.text)),
    ...post.links.filter(isHttpUrl),
  ]);
}

export function mediaUrls(post: {
  assets: { source: string; thumbnail: string | null }[];
}): string[] {
  const urls: string[] = [];
  for (const asset of post.assets) {
    if (isHttpUrl(asset.source)) urls.push(asset.source);
    if (asset.thumbnail && isHttpUrl(asset.thumbnail) && asset.thumbnail !== asset.source) {
      urls.push(asset.thumbnail);
    }
  }
  return unique(urls);
}
