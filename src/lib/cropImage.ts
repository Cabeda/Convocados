/**
 * Browser-side image helpers for the profile photo cropper. Kept separate
 * from `profilePhoto.ts` so the validation module stays environment-agnostic
 * (and unit-testable in Node).
 */
import { PROFILE_PHOTO_DIMENSION } from "./profilePhoto";

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding-box size of an image after rotating it by `rotationDeg`. */
export function rotateSize(
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rotRad = (rotationDeg * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

/** Read a File/Blob into a data URL. */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

/** Load an `HTMLImageElement` from a src (data URL or object URL). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image."));
    image.src = src;
  });
}

/** Export a canvas as WebP, falling back to JPEG where WebP is unsupported. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.85): string {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Crop `src` to `area` (pixels in the source image, rotation-aware) and export
 * a square data URL of `PROFILE_PHOTO_DIMENSION` px. Canvas re-encoding also
 * strips EXIF/GPS metadata from the original photo.
 */
export async function cropImageToDataUrl(
  src: string,
  area: CropArea,
  rotationDeg = 0,
): Promise<string> {
  const image = await loadImage(src);

  const rotated = rotateSize(image.width, image.height, rotationDeg);
  const stage = document.createElement("canvas");
  stage.width = rotated.width;
  stage.height = rotated.height;
  const stageCtx = stage.getContext("2d");
  if (!stageCtx) throw new Error("Canvas is not supported in this browser.");

  const rotRad = (rotationDeg * Math.PI) / 180;
  stageCtx.translate(rotated.width / 2, rotated.height / 2);
  stageCtx.rotate(rotRad);
  stageCtx.translate(-image.width / 2, -image.height / 2);
  stageCtx.drawImage(image, 0, 0);

  const out = document.createElement("canvas");
  out.width = PROFILE_PHOTO_DIMENSION;
  out.height = PROFILE_PHOTO_DIMENSION;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("Canvas is not supported in this browser.");

  outCtx.drawImage(
    stage,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    PROFILE_PHOTO_DIMENSION,
    PROFILE_PHOTO_DIMENSION,
  );

  return canvasToDataUrl(out);
}
