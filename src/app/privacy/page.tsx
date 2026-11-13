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
            For the dashboard, after you approve access, the access token is encrypted with AES-256-GCM and stored in an
            httpOnly cookie in your browser. Signing out deletes the cookie. When the session ends, PostGuard asks you to
            connect again. Nothing about the dashboard sign-in is stored on the server.
          </p>
          <p style={{ marginTop: 12 }} data-testid="privacy-alerts">
            <strong>Alert emails are different.</strong> Alerts are optional and only the owner of a deployment can turn
            them on. When alerts are on, PostGuard checks the queue once a day and sends an email about posts that will
            publish in roughly the next 27 hours and have a Blocker or High problem. To do that while you are away, it
            asks Buffer for a separate sign-in and stores that sign-in&rsquo;s refresh token on the server (with the short-lived access token it was last given), in a Redis
            database (Upstash), encrypted with AES-256-GCM. The same database keeps the time of the last check, an
            unsubscribe token, and hashed markers of which post problems were already emailed, so you are not emailed
            twice. The recipient address is a deployment setting, not stored in the database. The email contains the
            channel name, publish time, a short caption snippet and the problems found, and is sent through Resend.
            Alerts use the same read-only scopes. Turning alerts off on the setup page, or using the unsubscribe link in
            any alert, deletes the stored token. Signing out of the dashboard does not revoke the alert sign-in, because it is a separate grant: use <em>Turn alerts off</em> on the setup page or the unsubscribe link. You can also revoke the app in Buffer under Settings → API.
          </p>
          <p style={{ marginTop: 12 }}>
            Scan results are kept in memory on the server for about 10 minutes. Reloading the dashboard uses that
            copy and does not call Buffer again. Scan again bypasses the cache. Once the new result is on screen, the
            address bar drops the refresh flag, so a later reload uses the saved result. The dashboard does not write
            scan results to a database (the owner-only alert feature above keeps only the markers it lists). Demo mode uses a built-in fixture and does not call Buffer.
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
