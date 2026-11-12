import Link from "next/link";
import { Brand } from "@/components/Brand";
import { oauthConfigured } from "@/config";

function authMessage(code: string): string {
  if (code === "session_expired") {
    return "Your Buffer session expired. Connect again to scan the queue.";
  }
  if (code === "not_configured") return "Buffer sign-in is not configured in this environment. Demo mode does not need an account.";
  if (code === "access_denied") return "Buffer sign-in was cancelled. Nothing was changed.";
  if (code === "state_mismatch") return "The sign-in attempt did not match the one this browser started. Connect again.";
  // Only short, code-shaped values are shown. Anything else could be attacker-written text on our domain.
  if (/^[a-z][a-z0-9_]{0,39}$/.test(code)) {
    return `Buffer sign-in did not finish (${code.replaceAll("_", " ")}). Demo mode does not need an account.`;
  }
  return "Buffer sign-in did not finish. Demo mode does not need an account.";
}

const CHECKS = [
  ["Dead and expiring links", "A URL that answered when you queued the post, and will not when Buffer publishes it."],
  ["Media Buffer cannot fetch", "Google Drive, Dropbox, and signed S3 or Cloudinary URLs fail at publish time."],
  ["Text that no longer fits", "UTF-16, LinkedIn’s 24-character URLs, Instagram line breaks, X’s weights, Bluesky graphemes."],
  ["Missing alt text", "Images with an empty alt, a filename, or the word “image”."],
  ["Duplicates", "The same post, or a near copy, queued twice on one channel or across channels an hour apart."],
  ["Channel state", "Disconnected, locked, or paused queues that still have posts sitting in them."],
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const params = await searchParams;
  const configured = oauthConfigured();
  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <Link href="/privacy">Privacy</Link>
          <Link className="button secondary small" href="/demo">Demo</Link>
        </div>
        <p className="proof">
          {configured
            ? "Read-only · 2 data scopes · live Buffer API"
            : "Read-only · 2 data scopes · demo uses sample data"}
        </p>
      </header>
      <main id="main" className="wrap">
        {params.auth_error ? (
          <p className="banner" role="alert">{authMessage(params.auth_error)}</p>
        ) : null}
        <section className="hero">
          <p className="kicker">Buffer queue, pre-flight</p>
          <h1>Valid when queued. Broken at publish.</h1>
          <p className="lede">
            PostGuard signs in with Buffer, reads the next week of scheduled posts, and flags the ones that will fail,
            look broken, or never go out. It is read-only. Each finding links to the channel in Buffer.
          </p>
          <div className="cta-row">
            <Link className="button" href="/demo">Try the demo queue</Link>
            {/* A plain anchor: next/link would prefetch this route handler on page load, which sets the OAuth state cookie early and logs a CORS error. */}
            <a className="button secondary" href="/api/auth/start">Connect Buffer</a>
          </div>
          <p className="fine">
            {configured
              ? "Connecting asks for the data scopes account:read and posts:read, and for offline_access. Buffer may not grant a refresh token. PostGuard never publishes."
              : "OAuth is not configured in this environment. The demo queue is the full product with recorded posts, and it makes no Buffer API calls."}
          </p>
        </section>
        <section className="section grid-3">
          {CHECKS.map(([title, body]) => (
            <article key={title} className="card">
              <h2>{title}</h2>
              <p>{body}</p>
            </article>
          ))}
        </section>
        <section className="section grid-2">
          <article className="card">
            <h2>Shared quota, treated as scarce</h2>
            <p>
              Buffer limits an app client across every user who connects it. A scan is at least four requests: the
              account, the channels, one page of posts, and one page of posts with no publish time. Including drafts
              adds a fifth. It is not a request per post. Results stay cached for 10 minutes, the meter shows what the
              last response had left, and paging stops when the 15-minute window is nearly empty.
            </p>
          </article>
          <article className="card">
            <h2>Judges can skip the login</h2>
            <p>
              Demo mode replays a Northwind Studio queue with dead links, a duplicate, missing alt text, a paused
              channel, a signed media URL, and a LinkedIn post written in Unicode bold. Nothing is sent to Buffer.
            </p>
          </article>
        </section>
      </main>
      <footer className="wrap site">
        <span>Built for Buffer Commit. Read-only.</span>
        <span>
          <Link href="/testing">How it’s tested</Link>
          {" · "}
          <a href="https://developers.buffer.com">Buffer API docs</a>
        </span>
      </footer>
    </>
  );
}
