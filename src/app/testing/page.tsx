import Link from "next/link";
import { Brand } from "@/components/Brand";

export const metadata = { title: "How PostGuard is tested" };

export default function TestingPage() {
  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <Link href="/">Home</Link>
      </header>
      <main id="main" className="wrap section">
        <p className="kicker">Quality evidence</p>
        <h1>How PostGuard is tested</h1>
        <p className="lede">
          The checks are pure functions. The demo queue is the same code path as a live scan, with the HTTP and the
          model swapped for fixtures. CI runs lint, the typecheck, the unit tests, and a browser pass.
        </p>
        <div className="grid-2">
          <article className="card">
            <h2>Unit tests</h2>
            <p>
              Every rule has table cases: UTF-16 versus graphemes, the family emoji, LinkedIn’s 24-character URL,
              Instagram line breaks, dead links versus a 403 that only means “could not verify”, signed media URLs,
              alt text, duplicates inside an hour, and a paused channel with nothing queued. Token parsing covers a
              response with no refresh token, and the expiry decision is reconnect rather than a throw.
            </p>
          </article>
          <article className="card">
            <h2>Browser</h2>
            <p>
              Playwright opens the demo queue, checks the headline counts, the crop caption, the draft toggle, the
              recorded alt-text suggestion, and the link back to Buffer. <code>@axe-core/playwright</code> fails the
              build on serious or critical violations on the home page, the demo, this page, and the privacy page.
            </p>
          </article>
        </div>
        <article className="card" style={{ marginTop: 14 }}>
          <h2>What CI does not claim</h2>
          <p>
            A live Buffer account is not in CI. The GraphQL normalizer is tested against a payload shaped like the
            published schema, and the OAuth URL is tested against the documented parameters. Production sign-in was
            checked by hand against a real account. Link checks and AI suggestions are not required for the scan to
            finish: both fail soft.
          </p>
        </article>
      </main>
    </>
  );
}
