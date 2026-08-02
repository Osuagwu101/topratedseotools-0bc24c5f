/**
 * Browser-side tool icon normalisation.
 *
 * Every catalogue icon is rendered at 40×40–48×48, so we downscale to a square
 * 128×128 (2–3× for retina), centre-crop to keep the icon square like the
 * existing brand marks, and re-encode as WebP for a small file. Resizing here
 * (canvas) keeps the server free of native image libraries.
 */

export const TOOL_ICON_SIZE = 128;

export interface ResizedIcon {
  base64: string;
  contentType: "image/webp" | "image/png";
  bytes: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image"));
    };
    img.src = url;
  });
}

function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Resize + centre-crop + compress an uploaded icon. */
export async function resizeToolIcon(file: File, size = TOOL_ICON_SIZE): Promise<ResizedIcon> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is too large (max 8MB before resizing)");

  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process this image");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Centre-crop the source to a square before scaling down.
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  let contentType: ResizedIcon["contentType"] = "image/webp";
  let dataUrl = canvas.toDataURL("image/webp", 0.9);
  if (!dataUrl.startsWith("data:image/webp")) {
    // Very old browsers: fall back to PNG (transparency preserved).
    contentType = "image/png";
    dataUrl = canvas.toDataURL("image/png");
  }
  const base64 = toBase64(dataUrl);
  return { base64, contentType, bytes: Math.round((base64.length * 3) / 4) };
}
