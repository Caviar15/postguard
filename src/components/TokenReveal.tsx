"use client";

import { useState } from "react";

function mask(token: string): string {
  if (token.length <= 10) return "•".repeat(token.length);
  return `${token.slice(0, 3)}${"•".repeat(24)}${token.slice(-4)}`;
}

/** Shows a one-time token masked. The full value only appears on Show or Copy, and is never logged. */
export function TokenReveal({ token }: { token: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setShown(true);
    }
  }

  return (
    <div className="token-box">
      <code className="token-value" data-testid="token-value" aria-label="Refresh token">
        {shown ? token : mask(token)}
      </code>
      <div className="cta-row">
        <button type="button" className="button secondary small" aria-pressed={shown} onClick={() => setShown((value) => !value)}>
          {shown ? "Hide" : "Show"}
        </button>
        <button type="button" className="button small" onClick={copy}>
          {copied ? "Copied" : "Copy token"}
        </button>
      </div>
    </div>
  );
}
