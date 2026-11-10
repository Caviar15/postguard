/**
 * Opens the channel in Buffer's publish app and passes the post id.
 *
 * Buffer's January 2026 changelog says each post has its own URL, but that
 * path is not part of the public API reference, so it is not safe to guess a
 * `/post/:id` route. The channel id is a real API field. `?post=` is included
 * so the link stays specific, and so this one function can be pointed at a
 * confirmed route later without touching the rules.
 */
export function bufferFixUrl(channelId: string, postId?: string | null): string {
  const url = new URL(`https://publish.buffer.com/channels/${encodeURIComponent(channelId)}`);
  if (postId) url.searchParams.set("post", postId);
  return url.toString();
}
