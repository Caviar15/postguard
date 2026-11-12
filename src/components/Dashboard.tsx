"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { READINESS_LABEL } from "@/domain/readiness";
import { SEVERITY_LABEL, type AltSuggestion, type ScanReport, type Severity } from "@/domain/types";
import { CropPreview } from "./CropPreview";
import { Brand } from "./Brand";
import { addCalendarDays, calendarDay, timelineZone } from "@/domain/timeline";
import { formatDue, serviceLabel } from "./service";

const SEVERITIES: Severity[] = ["blocker", "high", "medium", "low", "info"];
const DAY_CHOICES = [3, 7, 14];

type LiveSuggestion =
  | { state: "loading" }
  | { state: "ready"; altText: string; mismatch: string | null }
  | { state: "notice"; message: string };

export function Dashboard({
  report,
  basePath,
  sessionNote,
}: {
  report: ScanReport;
  basePath: string;
  sessionNote?: string | null;
}) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [suggest, setSuggest] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState<Record<string, LiveSuggestion>>({});

  const query = (days: number, drafts = report.includeDrafts) => {
    const params = new URLSearchParams({ days: String(days) });
    if (drafts) params.set("drafts", "1");
    return `${basePath}?${params.toString()}`;
  };

  useEffect(() => {
    if (!suggest || report.mode !== "live") return;
    const pending = report.cards.filter(
      (card) => card.needsAlt && card.preview?.src && !report.suggestions.some((item) => item.postId === card.id),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    for (const card of pending) {
      setLiveSuggestions((current) => ({ ...current, [card.id]: { state: "loading" } }));
      void fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: card.preview?.src, caption: card.excerpt, service: card.service }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as
            | { ok: true; altText: string; mismatch: string | null }
            | { ok: false; message?: string }
            | null;
          if (cancelled) return;
          if (body && "ok" in body && body.ok) {
            setLiveSuggestions((current) => ({
              ...current,
              [card.id]: { state: "ready", altText: body.altText, mismatch: body.mismatch },
            }));
          } else {
            setLiveSuggestions((current) => ({
              ...current,
              [card.id]: { state: "notice", message: body && "message" in body && body.message ? body.message : "No suggestion this time." },
            }));
          }
        })
        .catch(() => {
          if (cancelled) return;
          setLiveSuggestions((current) => ({
            ...current,
            [card.id]: { state: "notice", message: "AI Gateway is unavailable, so there is no suggestion." },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [suggest, report]);

  const visibleCards = useMemo(() => {
    if (filter === "all") return report.cards;
    return report.cards.filter((card) => report.findings.some((finding) => finding.postId === card.id && finding.severity === filter));
  }, [filter, report.cards, report.findings]);

  const axis = timelineZone(report.cards.map((card) => card.timeZone));
  const days = timelineDays(report.scannedAt, Math.min(report.windowDays, 7), axis.zone);
  const undated = report.cards.filter((card) => !card.dueAt);

  return (
    <>
      <header className="wrap topbar">
        <Brand />
        <div className="top-actions">
          <span className="pill">{report.mode === "demo" ? "Demo queue" : report.organization.name}</span>
          {report.mode === "demo" ? (
            <a className="button secondary small" href="/api/auth/start">Connect Buffer</a>
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
        <p className="summary" data-testid="risk">{report.riskHeadline}</p>
        <p className="lede" data-testid="summary">{report.headline}</p>
        {sessionNote ? <p className="banner">{sessionNote}</p> : null}
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
        <div className="toolbar">
          <div className="days" aria-label="Scan window">
            <span className="fine">Window</span>
            {DAY_CHOICES.map((daysChoice) => (
              <Link key={daysChoice} href={query(daysChoice)} aria-current={daysChoice === report.windowDays ? "page" : undefined}>
                {daysChoice} days
              </Link>
            ))}
            <Link href={query(report.windowDays, !report.includeDrafts)} aria-current={report.includeDrafts ? "page" : undefined}>
              {report.includeDrafts ? "Drafts included" : "Include drafts"}
            </Link>
            <Link href={`${query(report.windowDays)}&refresh=1`}>Scan again</Link>
          </div>
          <button type="button" className="button small secondary" aria-pressed={suggest} onClick={() => setSuggest((value) => !value)}>
            Suggest alt text
          </button>
        </div>
        {suggest ? (
          <p className="fine">
            Suggestions are advisory. PostGuard does not edit the post. Demo suggestions are recorded examples and do not call a model.
          </p>
        ) : null}
        <div className="channel-row">
          {report.channels.map((channel) => (
            <div key={channel.id} className={`channel-chip readiness-${channel.readiness}`}>
              <strong>{channel.name}</strong>
              <span>
                {serviceLabel(channel.service)} · {channel.postCount} {channel.postCount === 1 ? "post" : "posts"} · score {channel.score}
              </span>
              <span className={`readiness readiness-${channel.readiness}`}>{READINESS_LABEL[channel.readiness]}</span>
              {channel.isQueuePaused ? <span className="flag">Paused</span> : null}
              {channel.isDisconnected ? <span className="flag">Disconnected</span> : null}
              {channel.isLocked ? <span className="flag">Locked</span> : null}
            </div>
          ))}
        </div>
        <section aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Upcoming</h2>
          <p className="fine">Days in {axis.label}</p>
          <div className="timeline" data-testid="timeline">
            {days.map((day) => {
              const posts = report.cards.filter((card) => card.dueAt && calendarDay(card.dueAt, axis.zone) === day);
              return (
                <div key={day} className="day">
                  <span className="day-label">{dayLabel(day)}</span>
                  {posts.length === 0 ? <span className="day-empty">Clear</span> : null}
                  {posts.map((card) => (
                    <a key={card.id} className={`dot dot-${card.readiness}`} href={`#post-${card.id}`}>
                      <span className="sr-only">{READINESS_LABEL[card.readiness]} {card.excerpt}</span>
                    </a>
                  ))}
                </div>
              );
            })}
            {undated.length > 0 ? (
              <div className="day">
                <span className="day-label">No time</span>
                {undated.map((card) => (
                  <a key={card.id} className={`dot dot-${card.readiness}`} href={`#post-${card.id}`}>
                    <span className="sr-only">{card.status} {card.excerpt}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </section>
        {report.postsScanned === 0 ? (
          <section className="card empty-queue">
            <h2>Nothing is queued in this window.</h2>
            <p>
              {report.includeDrafts
                ? "There are no drafts or scheduled posts to check."
                : "Scheduled posts will show up here. Include drafts to check a post before it is scheduled, or open the demo queue."}
            </p>
            <div className="cta-row">
              {report.includeDrafts ? null : <Link className="button" href={query(report.windowDays, true)}>Include drafts</Link>}
              <Link className="button secondary" href="/demo">Try the demo queue</Link>
            </div>
          </section>
        ) : null}
        <div className="filters" role="toolbar" aria-label="Filter by severity">
          <button type="button" className="button small secondary" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          {SEVERITIES.map((severity) => (
            <button key={severity} type="button" className="button small secondary" aria-pressed={filter === severity} onClick={() => setFilter(severity)}>
              {SEVERITY_LABEL[severity]} ({report.totals[severity]})
            </button>
          ))}
        </div>
        {visibleCards.length === 0 && report.postsScanned > 0 ? <p>Nothing at this severity in the current window.</p> : null}
        <div className="post-list">
          {visibleCards.map((card) => {
            const findings = report.findings.filter((finding) => finding.postId === card.id);
            const recorded = report.suggestions.find((item) => item.postId === card.id);
            const live = liveSuggestions[card.id];
            return (
              <article key={card.id} id={`post-${card.id}`} className={`post-card readiness-${card.readiness}`} data-readiness={card.readiness}>
                {card.preview ? <CropPreview preview={card.preview} /> : <div className="crop-spacer" />}
                <div>
                  <div className="meta">
                    <span className={`readiness readiness-${card.readiness}`}>{READINESS_LABEL[card.readiness]}</span>
                    <span>{serviceLabel(card.service)} · {card.channelName}</span>
                    <span>{formatDue(card.dueAt)}</span>
                    {card.status === "draft" ? <span className="pill">Draft</span> : null}
                    {card.status === "sending" ? <span className="pill">Sending</span> : null}
                  </div>
                  <h2>{card.channelName}</h2>
                  {card.excerpt ? <p className="excerpt">{card.excerpt}</p> : null}
                  {findings.map((finding) => (
                    <div key={finding.id} className="finding-inline" data-severity={finding.severity}>
                      <h3>{finding.title}</h3>
                      <p>{finding.detail}</p>
                    </div>
                  ))}
                  {findings.length === 0 ? <p className="fine">No problems on this post.</p> : null}
                  {suggest && card.needsAlt ? (
                    <Suggestion
                      recorded={recorded}
                      live={live}
                      hasImage={Boolean(card.preview?.src)}
                      demo={report.mode === "demo"}
                    />
                  ) : null}
                  <a href={card.fixUrl} target="_blank" rel="noopener noreferrer">Fix in Buffer</a>
                </div>
              </article>
            );
          })}
        </div>
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
        <span>
          <Link href="/testing">How it’s tested</Link>
          {" · "}
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
    </>
  );
}

function Suggestion({
  recorded,
  live,
  hasImage,
  demo,
}: {
  recorded: AltSuggestion | undefined;
  live: LiveSuggestion | undefined;
  hasImage: boolean;
  demo: boolean;
}) {
  const altText = recorded?.altText ?? (live?.state === "ready" ? live.altText : null);
  const mismatch = recorded?.mismatch ?? (live?.state === "ready" ? live.mismatch : null);
  const notice = !recorded && live?.state === "notice" ? live.message : null;
  return (
    <div className="suggestion">
      <p className="advisory">Suggestion, not applied</p>
      {altText ? (
        <>
          <p>{altText}</p>
          {mismatch ? <p className="fine">{mismatch}</p> : null}
          <button type="button" className="button small secondary" onClick={() => void navigator.clipboard.writeText(altText)}>
            Copy alt text
          </button>
        </>
      ) : notice ? (
        <p>{notice}</p>
      ) : !recorded && !hasImage && !demo ? (
        // No request is ever sent for a post whose image has no usable preview, so do not promise one.
        <p>Buffer did not return a preview image for this post, so there is nothing to describe.</p>
      ) : (
        <p role="status">{demo ? "No recorded suggestion for this image." : "Asking the model…"}</p>
      )}
    </div>
  );
}

function timelineDays(scannedAt: string, count: number, timeZone: string): string[] {
  const start = calendarDay(scannedAt, timeZone);
  return Array.from({ length: count }, (_, index) => addCalendarDays(start, index));
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
}
