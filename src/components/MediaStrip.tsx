"use client";

import { useState } from "react";
import type { CardThumb } from "@/domain/thumbs";

export function MediaStrip({ thumbs, extra }: { thumbs: CardThumb[]; extra: number }) {
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  if (thumbs.length === 0) return null;
  return (
    <div className="media-strip">
      {thumbs.map((thumb, index) => {
        const more = index === thumbs.length - 1 && extra > 0 ? extra : 0;
        return (
          <div className="media-frame" key={`${thumb.src}-${index}`}>
            {failed[index] ? (
              <div className="media-fallback" role="img" aria-label={thumb.alt || "Image unavailable"} />
            ) : (
              // Fixture and Buffer URLs are not in the image optimizer allow-list.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb.src}
                alt={thumb.alt}
                loading="lazy"
                decoding="async"
                onError={() => setFailed((current) => ({ ...current, [index]: true }))}
              />
            )}
            {thumb.kind === "video" ? (
              <span className="play-badge" aria-label="Video">
                <span aria-hidden="true">▶</span>
              </span>
            ) : null}
            {more > 0 ? <span className="media-more">+{more}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
