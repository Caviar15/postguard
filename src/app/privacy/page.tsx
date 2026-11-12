import Link from "next/link";
import { Brand } from "@/components/Brand";

export const metadata = {
  title: "Privacy — PostGuard",
};

export default function PrivacyPage() {
  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <Link href="/">Home</Link>
      </header>
      <main id="main" className="wrap section">
        <p className="kicker">Privacy</p>
        <h1>What PostGuard stores</h1>
        <div className="card">
          <p>
            PostGuard is a read-only check of a Buffer queue. The OAuth request asks for the data scopes{" "}
            <code>account:read</code> and <code>posts:read</code>, and to keep the session when Buffer allows it. It does
            not request permission to create or edit posts.
          </p>
          <p style={{ marginTop: 12 }}>
            After you approve access, the access token is encrypted with AES-256-GCM and stored in an httpOnly cookie.
            Signing out deletes the cookie. When the session ends, PostGuard asks you to connect again.
          </p>
          <p style={{ marginTop: 12 }}>
            Scan results are kept in memory on the server for about 10 minutes. Reloading the dashboard uses that
            copy and does not call Buffer again. Scan again bypasses the cache. Once the new result is on screen, the
            address bar drops the refresh flag, so a later reload uses the saved result. Results are not written to a
            database. Demo mode uses a built-in fixture and does not call Buffer.
          </p>
          <p style={{ marginTop: 12 }}>
            If you press <em>Suggest alt text</em>, the URL of that post&rsquo;s image and its caption are sent to a vision
            model through the Vercel AI Gateway to write a suggestion. Nothing is sent until you press the button, the
            demo never calls a model, and results are kept in server memory for up to 24 hours.
          </p>
          <p style={{ marginTop: 12 }}>
            To disconnect PostGuard, sign out here and revoke the app from Buffer under Settings → API. That invalidates
            the tokens even if a cookie is left behind.
          </p>
          <p style={{ marginTop: 12 }}>
            PostGuard does not sell data, and it does not run third-party analytics. Link checks request the URL with a
            PostGuard user agent. Those requests go to the host in the post, not to Buffer.
          </p>
        </div>
      </main>
    </>
  );
}
