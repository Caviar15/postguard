import { stripTrailingPunctuation } from "@/domain/urls";

function urlPattern(): RegExp {
  return /https?:\/\/[^\s<>"')\]]+/gi;
}

/** UTF-16 code units. This is `String.length` and what Buffer uses on most networks. */
export function utf16Length(text: string): number {
  return text.length;
}

function walkUrls(
  text: string,
  onUrl: (url: string, trailing: string) => number,
): number {
  let length = 0;
  let last = 0;
  for (const match of text.matchAll(urlPattern())) {
    const start = match.index ?? 0;
    length += text.slice(last, start).length;
    const raw = match[0];
    const url = stripTrailingPunctuation(raw);
    const trailing = raw.slice(url.length);
    length += onUrl(url, trailing);
    last = start + raw.length;
  }
  length += text.slice(last).length;
  return length;
}

/** LinkedIn counts every URL as 24, regardless of its real length. */
export function linkedInLength(text: string): number {
  return walkUrls(text, (_url, trailing) => 24 + trailing.length);
}

/** Instagram counts each line break as 2. `String.length` already counts `\n` once. */
export function instagramLength(text: string): number {
  const breaks = text.match(/\n/g)?.length ?? 0;
  return text.length + breaks;
}

/**
 * Mastodon counts URLs as 23 and drops the server part of `@user@server` mentions.
 * Buffer caps the server limit at 20,000; that cap is applied by the caller.
 */
export function mastodonLength(text: string): number {
  let length = walkUrls(text, (_url, trailing) => 23 + trailing.length);
  const mention = /(^|[^\w])@([A-Za-z0-9_]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  for (const match of text.matchAll(mention)) {
    length -= `@${match[3]}`.length;
  }
  return Math.max(0, length);
}

function graphemeCount(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(text)) count += 1;
  return count;
}

/**
 * Bluesky counts graphemes. A URL counts as the host plus at most 16 further
 * characters, per Buffer's character-limits guide.
 */
export function blueskyLength(text: string): number {
  const replaced = text.replace(urlPattern(), (raw) => {
    const url = stripTrailingPunctuation(raw);
    const trailing = raw.slice(url.length);
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    const extra = Math.min(16, Math.max(0, url.length - host.length));
    return "x".repeat(host.length + extra) + trailing;
  });
  return graphemeCount(replaced);
}

function isEmojiGrapheme(grapheme: string): boolean {
  return /\p{Extended_Pictographic}/u.test(grapheme);
}

function hasNonBmp(grapheme: string): boolean {
  for (const char of grapheme) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint > 0xffff) return true;
  }
  return false;
}

/**
 * A practical reading of Buffer's X rule: URLs weigh 23, emoji and non-BMP
 * characters (including Unicode bold) weigh 2, and a grapheme cluster that
 * stays inside the BMP weighs 1. That matches the guide's table for the
 * family ZWJ emoji (2, not 8) and for a combining accent (not an extra unit).
 * CJK weighting from twitter-text is not described in Buffer's guide, so it
 * is not applied.
 */
export function xLength(text: string): number {
  const pieces: string[] = [];
  let last = 0;
  let weight = 0;
  for (const match of text.matchAll(urlPattern())) {
    const start = match.index ?? 0;
    pieces.push(text.slice(last, start));
    const raw = match[0];
    const url = stripTrailingPunctuation(raw);
    weight += 23 + raw.length - url.length;
    last = start + raw.length;
  }
  pieces.push(text.slice(last));
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const piece of pieces) {
    for (const { segment } of segmenter.segment(piece)) {
      weight += isEmojiGrapheme(segment) || hasNonBmp(segment) ? 2 : 1;
    }
  }
  return weight;
}

/** Sans-serif mathematical bold, the range Buffer cites (U+1D5D4). */
export function mathBold(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + (code - 97));
      return char;
    })
    .join("");
}

export function containsUnicodeBold(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x1d400 && code <= 0x1d7ff) return true;
  }
  return false;
}

export function unicodeBoldCount(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x1d400 && code <= 0x1d7ff) count += 1;
  }
  return count;
}
