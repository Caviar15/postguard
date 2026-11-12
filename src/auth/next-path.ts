/**
 * Only an in-app path. WHATWG URL parsing treats a backslash like a slash and
 * drops tabs and newlines, so "/\evil.com" and "/<tab>/evil.com" both resolve to
 * "//evil.com". Parse against a dummy origin and refuse anything that leaves it.
 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const base = "https://postguard.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return "/dashboard";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/dashboard";
  }
}
