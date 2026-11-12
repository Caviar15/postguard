/**
 * Matches generously (parentheses and apostrophes are legal in paths) and lets
 * stripTrailingPunctuation decide where the URL really ends.
 */
export function urlPattern(): RegExp {
  return /https?:\/\/[^\s<>"\]\u201d\u2019]+/gi;
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * Drops sentence punctuation and quotes from the end, and a closing ")" only when
 * it has no "(" to pair with. That keeps https://en.wikipedia.org/wiki/Rust_(programming_language)
 * whole, while "(see https://a.example/x)" and "[docs](https://a.example/d)" still lose the bracket.
 */
export function stripTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const next = out.replace(/[.,!?;:'"*\u2026]+$/g, "");
    if (next !== out) {
      out = next;
      continue;
    }
    if (out.endsWith(")") && count(out, ")") > count(out, "(")) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
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
