import { createHash } from "node:crypto";

export const REVIEW_MODEL = "google/gemini-2.5-flash-lite";
export const REVIEW_HOURLY_CAP = 6;
/**
 * Per-session budgets reset on every new sign-in (the access token is the key), so
 * they cannot stop someone who reconnects. This ceiling is for the whole instance.
 */
export const REVIEW_GLOBAL_HOURLY_CAP = 40;
const GLOBAL_KEY = "__all__";

export type ReviewResult =
  | { ok: true; altText: string; mismatch: string | null; cached: boolean }
  | { ok: false; reason: "unavailable" | "capped" | "invalid"; message: string };

export function parseReview(text: string): { altText: string; mismatch: string | null } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { altText?: unknown; mismatch?: unknown };
    if (typeof parsed.altText !== "string" || parsed.altText.trim().length < 8) return null;
    const altText = parsed.altText.trim().slice(0, 140);
    const mismatch = typeof parsed.mismatch === "string" && parsed.mismatch.trim()
      ? parsed.mismatch.trim().slice(0, 240)
      : null;
    return { altText, mismatch };
  } catch {
    return null;
  }
}

type Budget = { windowStart: number; count: number };
const budgets = new Map<string, Budget>();
const suggestionCache = new Map<string, { at: number; altText: string; mismatch: string | null }>();

export function reviewBudgetKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function takeFrom(key: string, now: number, cap: number): boolean {
  const current = budgets.get(key);
  if (!current || now - current.windowStart > 60 * 60 * 1000) {
    budgets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (current.count >= cap) return false;
  current.count += 1;
  return true;
}

export function takeReviewSlot(key: string, now = Date.now(), cap = REVIEW_HOURLY_CAP): boolean {
  if (!takeFrom(key, now, cap)) return false;
  // Count the shared ceiling only after the session's own cap allowed it.
  return takeFrom(GLOBAL_KEY, now, REVIEW_GLOBAL_HOURLY_CAP);
}

export function reviewCacheKey(imageUrl: string, caption: string, service: string): string {
  return createHash("sha256").update(`${imageUrl}\n${service}\n${caption}`).digest("hex");
}

export function cachedReview(imageUrl: string, now = Date.now()): { altText: string; mismatch: string | null } | null {
  const hit = suggestionCache.get(imageUrl);
  if (!hit || now - hit.at > 24 * 60 * 60 * 1000) return null;
  return { altText: hit.altText, mismatch: hit.mismatch };
}

export function rememberReview(imageUrl: string, value: { altText: string; mismatch: string | null }, now = Date.now()): void {
  suggestionCache.set(imageUrl, { at: now, ...value });
}

function prompt(caption: string, service: string): string {
  return [
    "You write alt text for a social post that is not published yet.",
    "Reply with JSON only: {\"altText\":\"...\",\"mismatch\":null}",
    "altText is one sentence under 120 characters describing the image for someone who cannot see it.",
    "If the caption clearly does not match the image, set mismatch to one short sentence. Otherwise mismatch is null.",
    "Do not invent prices, names, or claims that are not visible.",
    `Network: ${service}.`,
    `Caption: ${caption || "(empty)"}`,
  ].join("\n");
}

export async function reviewImage(input: {
  imageUrl: string;
  caption: string;
  service: string;
  budgetKey: string;
}): Promise<ReviewResult> {
  // The mismatch note compares image and caption, so the caption and network are part of the key.
  const cacheId = reviewCacheKey(input.imageUrl, input.caption, input.service);
  const cached = cachedReview(cacheId);
  if (cached) return { ok: true, ...cached, cached: true };
  if (!takeReviewSlot(input.budgetKey)) {
    return {
      ok: false,
      reason: "capped",
      message: "The suggestion cap for this hour is used up (6 images). The scan itself is unchanged.",
    };
  }
  try {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: REVIEW_MODEL,
      abortSignal: AbortSignal.timeout(20_000),
      maxOutputTokens: 180,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt(input.caption, input.service) },
            { type: "image", image: new URL(input.imageUrl) },
          ],
        },
      ],
    });
    const parsed = parseReview(text);
    if (!parsed) {
      return { ok: false, reason: "unavailable", message: "The model did not return a usable suggestion." };
    }
    rememberReview(cacheId, parsed);
    return { ok: true, ...parsed, cached: false };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "AI Gateway is unavailable, so there is no suggestion. The scan does not need it.",
    };
  }
}
