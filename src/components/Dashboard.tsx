"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PRIORITIES, PRIORITY_LABEL, countPriorities, findingsForCard, selectCards } from "@/domain/readiness";
import type { AltSuggestion, Priority, ScanReport } from "@/domain/types";
import { CropNote } from "./CropPreview";
import { MediaStrip, MissingVideo } from "./MediaStrip";
import { Brand } from "./Brand";
import { addCalendarDays, calendarDay, timelineZone } from "@/domain/timeline";
import { DEMO_PLATFORMS, platformLabel, type DemoPlatform } from "@/demo/platforms";
import { formatDue, serviceLabel, serviceMark } from "./service";

const DAY_CHOICES = [3, 7, 14];
type SortKey = "priority" | "time";
type FilterKey = Priority | "all";

type LiveSuggestion =
  | { state: "loading" }
  | { state: "ready"; altText: string; mismatch: string | null }
  | { state: "notice"; message: string };

export function Dashboard({
  report,
  basePath,
  sessionNote,
  initialSort = "priority",
  initialFilter = "all",
  platform = "all",
}: {
  report: ScanReport;
  basePath: string;
  sessionNote?: string | null;
  /** From ?sort= on the server, so the first paint already has the right order. */
  initialSort?: SortKey;
  /** From ?filter= on the server, so the first paint already matches the chip. */
  initialFilter?: FilterKey;
  /** Demo example queue. Live scans ignore it. */
  platform?: DemoPlatform;
}) {
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [suggest, setSuggest] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState<Record<string, LiveSuggestion>>({});

  const query = (days: number, drafts = report.includeDrafts) => {
    const params = new URLSearchParams({ days: String(days) });
    if (drafts) params.set("drafts", "1");
    if (sort === "time") params.set("sort", "time");
    if (filter !== "all") params.set("filter", filter);
    if (platform !== "all") params.set("platform", platform);
    return `${basePath}?${params.toString()}`;
  };

  const platformHref = (next: DemoPlatform) => {
    const params = new URLSearchParams({ days: String(report.windowDays) });
    if (report.includeDrafts) params.set("drafts", "1");
    if (sort === "time") params.set("sort", "time");
    if (filter !== "all") params.set("filter", filter);
    if (next !== "all") params.set("platform", next);
    return `${basePath}?${params.toString()}`;
  };

  // A "Scan again" lands on ?refresh=1. Drop it from the address bar once the scan has rendered, so a
  // reload, back/forward or a copied link reads the cache instead of spending another scan of the shared quota.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("refresh") !== "1") return;
    url.searchParams.delete("refresh");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [report]);

  useEffect(() => setSort(initialSort), [initialSort]);
  useEffect(() => setFilter(initialFilter), [initialFilter]);

  function writeView(nextSort: SortKey, nextFilter: FilterKey) {
    const url = new URL(window.location.href);
    url.searchParams.delete("refresh");
    if (nextSort === "priority") url.searchParams.delete("sort");
    else url.searchParams.set("sort", nextSort);
    if (nextFilter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", nextFilter);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function chooseSort(next: SortKey) {
    setSort(next);
    writeView(next, filter);
  }

  function chooseFilter(next: FilterKey) {
    setFilter(next);
    writeView(sort, next);
  }

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

  const priorityCounts = useMemo(() => countPriorities(report.cards), [report.cards]);
  const visibleCards = useMemo(() => selectCards(report.cards, filter, sort), [filter, report.cards, sort]);

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
        <p className="proof">
          {report.mode === "demo"
            ? "Read-only · 2 data scopes · sample data, not a live queue"
            : "Read-only · 2 data scopes · live Buffer API"}
        </p>
      </header>
      <main id="main" className="wrap">
        <p className="kicker">{report.organization.name}</p>
        <h1>Queue health</h1>
        {report.mode === "demo" ? (
          <nav className="platforms" aria-label="Example queue">
            {DEMO_PLATFORMS.map((item) => (
              <Link key={item} href={platformHref(item)} aria-current={item === platform ? "page" : undefined}>
                {platformLabel(item)}
              </Link>
            ))}
          </nav>
        ) : null}
        <p className="summary" data-testid="risk">{report.riskHeadline}</p>
        <div className="channel-row">
          {report.channels.map((channel) => (
            <div key={channel.id} className={`channel-chip priority-${channel.priority}`}>
              <strong>{channel.name}</strong>
              <span className="service-line">
                <span className="service-mark" aria-hidden="true">{serviceMark(channel.service)}</span>
                {serviceLabel(channel.service)} · {channel.postCount} {channel.postCount === 1 ? "post" : "posts"} · score {channel.score}
              </span>
              <span className={`priority priority-${channel.priority}`}>{PRIORITY_LABEL[channel.priority]}</span>
              {channel.isQueuePaused ? <span className="flag">Paused</span> : null}
              {channel.isDisconnected ? <span className="flag">Disconnected</span> : null}
              {channel.isLocked ? <span className="flag">Locked</span> : null}
            </div>
          ))}
        </div>
        <p className="lede" data-testid="summary">{report.headline}</p>
        {sessionNote ? <p className="banner">{sessionNote}</p> : null}
        <div className="stats" aria-label="Posts by priority">
          {PRIORITIES.map((priority) => (
            <span key={priority} className={`stat priority-${priority}`}>
              <strong>{priorityCounts[priority]}</strong> {PRIORITY_LABEL[priority].toLowerCase()}
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
          <div className="sort" role="group" aria-label="Sort posts">
            <span className="fine">Sort</span>
            <button type="button" className="button small secondary" aria-pressed={sort === "priority"} onClick={() => chooseSort("priority")}>Priority</button>
            <button type="button" className="button small secondary" aria-pressed={sort === "time"} onClick={() => chooseSort("time")}>Publish time</button>
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
                    <a key={card.id} className={`dot dot-${card.priority}`} href={`#post-${card.id}`}>
                      <span className="sr-only">{PRIORITY_LABEL[card.priority]} {card.excerpt}</span>
                    </a>
                  ))}
                </div>
              );
            })}
            {undated.length > 0 ? (
              <div className="day">
                <span className="day-label">No time</span>
                {undated.map((card) => (
                  <a key={card.id} className={`dot dot-${card.priority}`} href={`#post-${card.id}`}>
                    <span className="sr-only">{PRIORITY_LABEL[card.priority]} {card.excerpt}</span>
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
        <div className="filters" role="toolbar" aria-label="Filter by priority">
          <button type="button" className="button small secondary" aria-pressed={filter === "all"} onClick={() => chooseFilter("all")}>All</button>
          {PRIORITIES.map((priority) => {
            const count = priorityCounts[priority];
            return (
              <button
                key={priority}
                type="button"
                className={`button small secondary filter-${priority}${count === 0 ? " is-empty" : ""}`}
                aria-pressed={filter === priority}
                aria-disabled={count === 0}
                onClick={() => {
                  if (count === 0) return;
                  chooseFilter(priority);
                }}
              >
                {PRIORITY_LABEL[priority]} ({count})
              </button>
            );
          })}
        </div>
        {visibleCards.length === 0 && report.postsScanned > 0 ? <p>No posts with this priority.</p> : null}
        <div className="post-list">
          {visibleCards.map((card) => {
            const findings = findingsForCard(report.findings, card);
            const recorded = report.suggestions.find((item) => item.postId === card.id);
            const live = liveSuggestions[card.id];
            return (
              <article key={card.id} id={`post-${card.id}`} className={`post-card priority-${card.priority}`} data-priority={card.priority}>
                <header className="meta">
                  <span className={`priority priority-${card.priority}`}>{PRIORITY_LABEL[card.priority]}</span>
                  <span className="service-line">
                    <span className="service-mark" aria-hidden="true">{serviceMark(card.service)}</span>
                    {serviceLabel(card.service)} · {card.channelName}
                  </span>
                  <span>{formatDue(card.dueAt)}</span>
                  {card.status === "draft" ? <span className="pill">Draft</span> : null}
                  {card.status === "needs_approval" ? <span className="pill">Awaiting approval</span> : null}
                  {card.status === "sending" ? <span className="pill">Sending</span> : null}
                </header>
                <h2>{card.channelName}</h2>
                <div className={card.media.length > 0 || card.service === "tiktok" ? "card-main has-media" : "card-main"}>
                  {card.media.length > 0 || card.service === "tiktok" ? (
                    <div className="card-media">
                      {card.media.length > 0 ? <MediaStrip thumbs={card.media} extra={card.mediaExtra} /> : <MissingVideo />}
                    </div>
                  ) : null}
                  <div className="card-text">
                    {card.excerpt ? <p className="excerpt">{card.excerpt}</p> : null}
                    {card.preview ? <CropNote preview={card.preview} /> : null}
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
