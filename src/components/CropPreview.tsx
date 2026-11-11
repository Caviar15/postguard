import type { CropPreview as CropPreviewData } from "@/domain/types";

export function CropPreview({ preview }: { preview: CropPreviewData }) {
  const caption = preview.cropped
    ? `${preview.width}×${preview.height}. A centered crop keeps ${preview.label}. The hatched area is what gets cut off.`
    : `${preview.width}×${preview.height} fits ${preview.label}. Nothing is cut off.`;
  return (
    <figure className={preview.cropped ? "crop" : "crop crop-ok"}>
      <div className="crop-frame" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
        {preview.src ? (
          // The frame matches the file's own ratio. The overlay, not CSS, does the crop.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.src} alt="" />
        ) : (
          <div className="crop-fallback" />
        )}
        {preview.top > 0 ? <div className="crop-shade" style={{ top: 0, height: `${preview.top * 100}%` }} /> : null}
        {preview.bottom > 0 ? <div className="crop-shade" style={{ bottom: 0, height: `${preview.bottom * 100}%` }} /> : null}
        {preview.left > 0 ? <div className="crop-shade crop-shade-side" style={{ left: 0, width: `${preview.left * 100}%` }} /> : null}
        {preview.right > 0 ? <div className="crop-shade crop-shade-side" style={{ right: 0, width: `${preview.right * 100}%` }} /> : null}
        <div
          className="crop-window"
          style={{
            top: `${preview.top * 100}%`,
            bottom: `${preview.bottom * 100}%`,
            left: `${preview.left * 100}%`,
            right: `${preview.right * 100}%`,
          }}
        />
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
