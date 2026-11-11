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
            PostGuard is a read-only check of a Buffer queue. The OAuth request asks for <code>account:read</code>,{" "}
            <code>posts:read</code>, and <code>offline_access</code>. It does not request permission to create or edit posts.
          </p>
          <p style={{ marginTop: 12 }}>
            After you approve access, the access token is encrypted with AES-256-GCM and stored in an httpOnly cookie.
            A refresh token is stored the same way only when Buffer returns one. The app-client form does not offer
            offline_access, so a sign-in often has no refresh token: the access token lasts about an hour, and PostGuard
            then asks you to connect again instead of failing the page. When a refresh token is present it rotates, and
            the cookie keeps only the newest one. Signing out deletes the cookie.
          </p>
          <p style={{ marginTop: 12 }}>
            Scan results are kept in memory on the server for about 10 minutes so a reload does not spend the shared
            Buffer rate limit again. They are not written to a database. Demo mode uses a built-in fixture and does not
            call Buffer.
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
