export type StaticUrlRisk = {
  kind: "expiring" | "private-host";
  reason: string;
};

/**
 * Patterns Buffer calls out as failing at publish time: signed or expiring
 * URLs, and share links that are not a direct public file.
 * https://developers.buffer.com/guides/hosting-media.md
 */
export function staticUrlRisk(rawUrl: string): StaticUrlRisk | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const href = url.href;
  const lower = href.toLowerCase();
  const params = url.searchParams;

  if (
    lower.includes("x-amz-expires") ||
    lower.includes("x-amz-signature") ||
    lower.includes("x-amz-security-token") ||
    params.has("X-Amz-Expires") ||
    params.has("X-Amz-Signature")
  ) {
    return { kind: "expiring", reason: "Amazon S3 pre-signed URL (X-Amz-Expires / X-Amz-Signature). Buffer fetches media when the post publishes, and this signature will have expired." };
  }

  const expires = params.get("Expires") ?? params.get("expires");
  const signature = params.get("Signature") ?? params.get("signature");
  if (expires && signature) {
    return { kind: "expiring", reason: "Signed URL with Expires and Signature parameters. It can work when the post is queued and fail when Buffer fetches it." };
  }

  if (/cloudinary\.com$/i.test(url.hostname) && /s--[a-z0-9_-]+--/i.test(href)) {
    return { kind: "expiring", reason: "Cloudinary signed delivery URL (s--signature--). Use the unsigned delivery URL instead." };
  }

  if (/drive\.google\.com$|docs\.google\.com$/i.test(url.hostname)) {
    return { kind: "private-host", reason: "Google Drive link. Buffer needs a direct file URL that loads without a Google login." };
  }

  if (/dropbox\.com$/i.test(url.hostname) && url.hostname !== "dl.dropboxusercontent.com") {
    return { kind: "private-host", reason: "Dropbox share link. These open a preview page, not the file Buffer has to download." };
  }

  if (/1drv\.ms$|onedrive\.live\.com$|sharepoint\.com$/i.test(url.hostname)) {
    return { kind: "private-host", reason: "OneDrive or SharePoint link. Buffer cannot fetch a file that sits behind a Microsoft login." };
  }

  return null;
}
