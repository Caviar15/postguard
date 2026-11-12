/**
 * Display files for fixture media. The checks still use the original fixture URLs.
 * Photos are Unsplash images saved under public/demo (Unsplash License) so the demo
 * does not call a third party at page load. Photo ids, in file order:
 * 1528459801416, 1523381210434, 1445205170230, 1490481651871, 1558171813,
 * 1512436991641, 1469334031218, 1489987707025, 1434389677669, 1521572163474,
 * 1556905055, 1441984904996, 1558618666, 1497366216548, 1503342217505.
 */
const SIGNED_MEDIA =
  "https://northwind-media.s3.amazonaws.com/palette.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=abc123";

export const DEMO_PHOTOS: Record<string, string> = {
  "https://cdn.northwind.example/dye.jpg": "/demo/dye.jpg",
  "https://cdn.northwind.example/hem.jpg": "/demo/hem.jpg",
  "https://cdn.northwind.example/draft.jpg": "/demo/draft.jpg",
  [SIGNED_MEDIA]: "/demo/palette.jpg",
  "https://cdn.northwind.example/ig-square.jpg": "/demo/ig-square.jpg",
  "https://cdn.northwind.example/ig-ready.jpg": "/demo/ig-ready.jpg",
  "https://cdn.northwind.example/ig-detail.jpg": "/demo/ig-detail.jpg",
  "https://cdn.northwind.example/tiktok-clip.jpg": "/demo/tiktok-clip.jpg",
  "https://cdn.northwind.example/tiktok-wide.jpg": "/demo/tiktok-wide.jpg",
  "https://cdn.northwind.example/tiktok-ok.jpg": "/demo/tiktok-ok.jpg",
  "https://cdn.northwind.example/tiktok-low.jpg": "/demo/tiktok-low.jpg",
  "https://cdn.northwind.example/tiktok-ready.jpg": "/demo/tiktok-ready.jpg",
  "https://cdn.northwind.example/fb-photo.jpg": "/demo/fb-photo.jpg",
  "https://cdn.northwind.example/fb-weak.jpg": "/demo/fb-weak.jpg",
  "https://cdn.northwind.example/li-desk.jpg": "/demo/li-desk.jpg",
  "https://cdn.northwind.example/x-ready.jpg": "/demo/x-ready.jpg",
};

/** Swap a fixture media URL for the shipped file. Anything else is left as-is. */
export function demoPhoto(src: string): string {
  return DEMO_PHOTOS[src] ?? src;
}
