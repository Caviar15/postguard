import type { CropPreview as CropPreviewData } from "@/domain/types";

/** One line of crop geometry. The picture itself is the card thumbnail, not a second frame. */
export function CropNote({ preview }: { preview: CropPreviewData }) {
  if (!preview.cropped) return null;
  return (
    <p className="crop-note">
      {preview.width}×{preview.height}. A centered crop keeps {preview.label}. The hatched area is what gets cut off.
    </p>
  );
}
