"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SEVERITY_LABEL, type ScanReport, type Severity } from "@/domain/types";
import { Brand } from "./Brand";
import { formatDue, serviceLabel } from "./service";

const SEVERITIES: Severity[] = ["blocker", "high", "medium", "low", "info"];
const DAY_CHOICES = [3, 7, 14];

export function Dashboard({ report, basePath }: { report: ScanReport; basePath: string }) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const visible = useMemo(
    () => (filter === "all" ? report.findings : report.findings.filter((finding) => finding.severity === filter)),
    [filter, report.findings],
  );

  const groups = SEVERITIES.map((severity) => {
    const findings = visible.filter((finding) => finding.severity === severity);
    const channels = new Map<string, typeof findings>();
    for (const finding of findings) {
      const list = channels.get(finding.channelId) ?? [];
      list.push(finding);
      channels.set(finding.channelId, list);
    }
    return { severity, findings, channels };
  }).filter((group) => group.findings.length > 0);

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <span className="pill">{report.mode === "demo" ? "Demo queue" : report.organization.name}</span>
          {report.mode === "demo" ? (
            <Link className="button secondary small" href="/api/auth/start">Connect Buffer</Link>
          ) : (
            <form action="/api/auth/logout" method="post">
              <button className="button secondary small" type="submit">Sign out</button>
            </form>
          )}
        </div>
      </header>
      <main id="main" className="wrap">
        <p className="kicker">{report.organization.name}</p>
        <h1>Queue health</h1>
        <p className="summary" data-testid="summary">{report.headline}</p>
        <div className="stats" aria-label="Findings by severity">
          {SEVERITIES.map((severity) => (
            <span key={severity} className={`stat ${severity}`}>
              <strong>{report.totals[severity]}</strong> {SEVERITY_LABEL[severity].toLowerCase()}
            </span>
          ))}
          <span className="stat"><strong>{report.postsScanned}</strong> posts</span>
        </div>
        <div className="quota" data-testid="quota">
          <span>{report.quota.label}</span>
          <span>{report.requestsUsed === 0 ? "0 API requests" : `${report.requestsUsed} API request${report.requestsUsed === 1 ? "" : "s"}`}{report.cached ? " · cached" : ""}</span>
        </div>
        <div className="days" aria-label="Scan window">
          <span className="fine">Window</span>
          {DAY_CHOICES.map((days) => (
            <Link key={days} href={`${basePath}?days=${days}`} aria-current={days === report.windowDays ? "page" : undefined}>
              {days} days
            </Link>
          ))}
          {report.mode === "live" ? (
            <Link href={`${basePath}?days=${report.windowDays}&refresh=1`}>Scan again</Link>
          ) : null}
        </div>
        <div className="channel-row">
          {report.channels.map((channel) => (
            <div key={channel.id} className="channel-chip">
              <strong>{channel.name}</strong>
              <span>
                {serviceLabel(channel.service)} · {channel.postCount} posts
                {channel.isQueuePaused ? <span className="flag"> · paused</span> : null}
                {channel.isDisconnected ? <span className="flag"> · disconnected</span> : null}
                {channel.isLocked ? <span className="flag"> · locked</span> : null}
              </span>
            </div>
          ))}
        </div>
        <div className="filters" role="toolbar" aria-label="Filter by severity">
          <button type="button" className="button small secondary" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              type="button"
              className="button small secondary"
              aria-pressed={filter === severity}
              onClick={() => setFilter(severity)}
            >
              {SEVERITY_LABEL[severity]} ({report.totals[severity]})
            </button>
          ))}
        </div>
        {groups.length === 0 ? <p>Nothing at this severity in the current window.</p> : null}
        {groups.map((group) => (
          <section key={group.severity} className="severity-block" aria-labelledby={`sev-${group.severity}`}>
            <h2 id={`sev-${group.severity}`}>
              {SEVERITY_LABEL[group.severity]} <span className="count">{group.findings.length}</span>
            </h2>
            {[...group.channels.entries()].map(([channelId, findings]) => (
              <div key={channelId} className="channel-block">
                <h3>
                  {findings[0]?.channelName} · {serviceLabel(findings[0]?.service ?? "")}
                </h3>
                {findings.map((finding) => (
                  <article key={finding.id} className="finding" data-severity={finding.severity} data-rule={finding.ruleId}>
                    <div className="meta">
                      <span className="pill">{SEVERITY_LABEL[finding.severity]}</span>
                      <span>{formatDue(finding.dueAt)}</span>
                      {finding.advisory ? <span className="advisory">Best effort</span> : null}
                    </div>
                    <h3>{finding.title}</h3>
                    <p className="detail">{finding.detail}</p>
                    {finding.excerpt ? <p className="excerpt">{finding.excerpt}</p> : null}
                    <div className="finding-foot">
                      <a href={finding.fixUrl} target="_blank" rel="noopener noreferrer">Fix in Buffer</a>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </section>
        ))}
        {report.notes.length > 0 ? (
          <section className="section">
            <h2>Notes</h2>
            <ul className="notes">
              {report.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        ) : null}
      </main>
      <footer className="wrap site">
        <span>Read-only. PostGuard does not edit or pause posts.</span>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </>
  );
}
