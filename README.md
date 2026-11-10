# PostGuard

PostGuard is a pre-flight check for a Buffer queue. It signs in with Buffer, reads the scheduled posts, and flags the ones that were fine when you queued them and will be broken when they publish.

> Next 7 days: 3 dead links, 1 duplicate, 2 missing alt text, 1 paused channel.

It is read-only. There is no pause mutation in the Buffer API, so each finding links to the post’s channel in Buffer instead of editing it.

## Demo, no account required

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **Try the demo queue**. Demo mode replays a fixture (Northwind Studio) and does not call Buffer, so it spends none of the shared app quota.

## Connect a real Buffer account

1. In Buffer, open [Settings → API](https://publish.buffer.com/settings/api) and create an app client.
2. Choose a **confidential / private** client. PostGuard keeps the secret on the server.
3. Permissions: `account:read`, `posts:read`, `offline_access`. Do not enable write scopes.
4. Redirect URI, matched exactly:
   - Local: `http://localhost:3000/api/auth/callback`
   - Production: `https://YOUR_PROJECT.vercel.app/api/auth/callback`
5. Privacy policy URL: `https://YOUR_PROJECT.vercel.app/privacy` (or `http://localhost:3000/privacy` while developing).
6. Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Purpose |
|---|---|---|
| `BUFFER_CLIENT_ID` | For live scans | App client id |
| `BUFFER_CLIENT_SECRET` | For a confidential client | Sent on the token and refresh calls. Omit only for a public client. |
| `BUFFER_REDIRECT_URI` | Yes, in production | Must match the URI registered above. Defaults to the request origin + `/api/auth/callback` when unset. |
| `SESSION_SECRET` | For live scans | Encrypts the refresh-token cookie. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `POSTGUARD_WINDOW_DAYS` | No | Default window (7). The dashboard can switch to 3 or 14. |
| `APP_URL` | No | Public origin, informational. |

Then `npm run dev`, and use **Connect Buffer**. The flow is OAuth 2.0 authorization code with PKCE (`S256`):

- Authorize: `GET https://auth.buffer.com/auth`
- Token: `POST https://auth.buffer.com/token`
- API: `POST https://api.buffer.com` with `Authorization: Bearer`

Access tokens last one hour. Refresh tokens are requested via `offline_access` and are single-use: every refresh stores the new refresh token and drops the old one. Reusing an old refresh token revokes the grant. Tokens sit in an AES-256-GCM httpOnly cookie, split if they do not fit in one cookie. Sign out deletes it. Users can also revoke the app from Buffer’s API settings.

## Deploy

Vercel is the straightforward host. Hobby is enough for the demo and a light judging load. A live scan of a large queue does HTTP checks and can run long; the route asks for 60 seconds (`maxDuration`). Hobby plans cap that lower, which is another reason the demo queue is the path to show judges.

1. Push this repo and import it at [vercel.com/new](https://vercel.com/new). Framework preset: Next.js. Root directory: the repo root.
2. Add the env vars from the table. Set `BUFFER_REDIRECT_URI` to `https://YOUR_PROJECT.vercel.app/api/auth/callback` and `APP_URL` to `https://YOUR_PROJECT.vercel.app`.
3. Deploy.
4. Register that exact redirect URI, and `https://YOUR_PROJECT.vercel.app/privacy`, on the Buffer app client.
5. Open the deployment. Confirm the demo queue, then connect a Buffer account and run one scan.

No database is required. Scan results are cached in memory for 10 minutes so a reload does not spend the quota again. Use **Scan again** to bypass the cache.

## What a scan does

One scan, on demand:

1. `account { organizations }`
2. `channels` for that organization (disconnected, locked, paused, Mastodon `maxCharacters`, X `subscriptionType`)
3. `posts` with `status: [scheduled, error, needs_approval]`, `dueAt` from 24 hours ago through the window, sorted by `dueAt`, page size 50, cursor in `after` / `pageInfo.endCursor`
4. One page of posts with `dueAtPresence: absent`, for queue items that have no publish time
5. HEAD, then GET, for the URLs in the copy and on the media. Signed and private-host URLs are classified without a request.

Paging stops after 12 pages or when the 15-minute `RateLimit` window has 2 requests left. The meter reads `RateLimit` and `RateLimit-Policy` and matches windows by `w` (900, 86400, 2592000), not by the policy name.

App-client limits are per client and shared by every connected user. As of the docs fetched 10 Nov 2026 they start at 100 / 15 minutes, 500 / 24 hours, and 15,000 / 30 days, and they grow per authorized user. The October planning note of “250/day” is out of date. PostGuard does not hard-code a daily budget; it follows the headers.

The Experimental `configuration` query is not called. Limits come from the [character-limits guide](https://developers.buffer.com/guides/character-limits.md), with the sources noted in the rules.

## Checks

| Rule | Severity | What it catches |
|---|---|---|
| `dead-link` | Blocker for 4xx/5xx/DNS. Medium for a chain over 3, http, or a redirect to the homepage. Low for 401/403/429/timeout. | URLs in the text, first comment, thread, link card, pin destination, shop link, and `url` annotations |
| `media-url` | Blocker | Unreachable media, `X-Amz-Expires` / `Expires`+`Signature`, Cloudinary `s--` signatures, Google Drive, Dropbox, OneDrive |
| `text-length` | Blocker over the limit, medium within 5% | Network limits and Buffer’s counting rules. YouTube `<` / `>` except on reminder posts |
| `fake-bold` | Low | Unicode mathematical letters, which count as two on UTF-16 networks |
| `first-comment` | Blocker over the limit. High if the caption says “link in comments” and the comment is empty, or the comment’s link is dead | Instagram, Facebook, LinkedIn only. Those are the metadata types that have `firstComment` |
| `field-limits` | Blocker | Pinterest and YouTube titles (100), YouTube `<` `>`, Threads topics (50, no `&` or `.`) |
| `thread-length` | Blocker | Each item of `metadata.thread` against the same limit as the post |
| `aspect-ratio` | High, advisory | Instagram feed 4:5–1.91:1, story/reel and TikTok 9:16, Pinterest around 2:3. A missing or zero dimension is ignored |
| `alt-text` | Medium | Empty `ImageMetadata.altText` |
| `weak-alt` | Low | Filename, “image”, or a copy of the caption |
| `video-alt` | Info, advisory | `VideoMetadata` has no alt text. Flagged only when the caption is very short |
| `duplicate` | High on the same channel within 24h. Medium across channels within 1h | Normalized text, Jaccard ≥ 0.9 on word shingles, or the same media URL |
| `channel-disconnected` / `channel-locked` | Blocker | Those flags, and at least one post in the window |
| `channel-paused` | Info | `isQueuePaused` with posts still queued |
| `schedule` | High | `dueAt` in the past, status still `scheduled` |
| `publishing-error` | High | `Post.error.message` |
| `notification-post` | Info | `schedulingType: notification` |
| `placeholder` | High | `TODO`, `TBD`, `FIXME`, lorem, `[link]`, `{{…}}`, `<name>`, `XXX` |
| `hashtags` | High over 30 on Instagram (advisory). Low for a broken `#` | Instagram’s cap is not a Buffer validation rule, so it stays a warning |

## Verified against the published schema, and what is still assumed

Checked against [the reference](https://developers.buffer.com/reference.md) and the guides on 10 Nov 2026. This environment had no Buffer client, so none of it was confirmed with a live call.

Confirmed in the docs and coded to match:

- OAuth authorize and token URLs, PKCE `S256`, and the refresh-token rotation warning.
- Scopes `account:read`, `posts:read`, `offline_access`. Access tokens expire in 3600 seconds.
- `posts` cursor pagination (`first`, `after`, `pageInfo.endCursor`). A page may return fewer posts than `first`; the client keeps following `endCursor`.
- Post fields used here: `text`, `status`, `dueAt`, `channelId`, `channelService`, `schedulingType`, `error.message`, `assets`, `metadata`.
- `ImageAsset.image { altText width height }`. `VideoAsset.video { width height durationMs }` and **no alt text**.
- `firstComment` on Instagram, Facebook, and LinkedIn only. Pinterest’s destination is `url`. Instagram’s shop link is `link`. Threads’ topic is `topic`. Annotations carry `url` and `type`.
- Channel flags `isDisconnected`, `isLocked`, `isQueuePaused`. Mastodon `maxCharacters`. X `subscriptionType` (an unstructured `String`).
- `dueAt` comparator and `dueAtPresence: absent`.
- Rate-limit header shape, including the space Buffer puts after each semicolon.
- Character limits and the counting exceptions (UTF-16, LinkedIn URL = 24, Instagram newline = 2, X weights, Bluesky graphemes, Mastodon URL = 23 and `@user@server`).

Assumed, and written so a mismatch shows up as a failed scan rather than a silent wrong report:

- `TwitterMetadata.subscriptionType` values are not an enum. Empty, `free`, and `none` use 280. A value containing basic, premium, or plus uses 25,000. Anything else stays on 280 and the finding says so.
- Queued posts with no `dueAt` come back from `dueAtPresence: absent` and `status: scheduled`. Only the first page is read.
- The “fix in Buffer” link is `https://publish.buffer.com/channels/{channelId}?post={postId}`. Buffer’s January 2026 changelog says each post has its own URL, but that path is not in the API reference. The channel id is a real field. Change `src/buffer/deep-link.ts` if a live account shows a different route.
- `ImageMetadata.width` / `height` can be 0. Those assets are skipped, not flagged.
- X counting follows the examples in the character-limits guide (emoji and non-BMP weigh 2, a combining mark does not add a unit, URLs weigh 23). The guide does not describe twitter-text’s CJK weighting, so it is not applied.
- `configuration` may or may not work on a Free plan. It is Experimental, so it is not called.
- Link checks can be blocked by a bot wall. 401, 403, and 429 are “could not verify”, not “dead”.

## Tests

```bash
npm test          # unit tests, Vitest
npm run typecheck
npm run test:e2e  # Playwright, demo dashboard. Builds first in CI.
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, a production build, and the Playwright demo. The demo test checks the headline counts, the Buffer link, the quota note, and the severity filter.

## Project map

```
src/auth        PKCE, token exchange, refresh, encrypted cookie
src/buffer      GraphQL queries, defensive normalizer, pagination, rate limits
src/rules       One module per check. Pure functions.
src/links       HEAD/GET checker and signed-URL patterns
src/scan        Live scan and the 10-minute cache
src/demo        Northwind fixture
src/app         Landing, demo, dashboard, privacy, OAuth routes
```
