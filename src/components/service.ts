const LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  twitter: "X",
  pinterest: "Pinterest",
  googlebusiness: "Google Business",
  youtube: "YouTube",
  mastodon: "Mastodon",
  tiktok: "TikTok",
  threads: "Threads",
  bluesky: "Bluesky",
  substack: "Substack",
  whatsapp: "WhatsApp",
  startPage: "Start Page",
};

export function serviceLabel(service: string): string {
  return LABELS[service] ?? service;
}

export function formatDue(iso: string | null, now = Date.now()): string {
  if (!iso) return "No publish time";
  const delta = new Date(iso).getTime() - now;
  if (Number.isNaN(delta)) return "Unscheduled";
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 90) {
    const value = Math.max(1, minutes);
    return delta < 0 ? `${value} min overdue` : `in ${value} min`;
  }
  const hours = Math.round(abs / 3_600_000);
  if (hours < 36) return delta < 0 ? `${hours} h overdue` : `in ${hours} h`;
  const days = Math.round(abs / 86_400_000);
  return delta < 0 ? `${days} d overdue` : `in ${days} d`;
}
