import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostGuard — queue health for Buffer",
  description: "Checks scheduled Buffer posts before they publish. Dead links, missing alt text, duplicates, paused channels, and text that no longer fits.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {children}
        <aside className="wrap site-note" aria-label="Disclaimer">Not affiliated with or endorsed by Buffer</aside>
      </body>
    </html>
  );
}
