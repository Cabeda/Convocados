/**
 * Profile photo upload constraints, shared by the web UI and the upload API.
 *
 * Images are stored inline on `User.image` as a base64 data URL so they ride
 * the existing SQLite + Litestream backup path — no object storage needed.
 */

/** MIME types accepted for a user-uploaded profile photo. */
export const PROFILE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ProfilePhotoMime = (typeof PROFILE_PHOTO_MIME_TYPES)[number];

/** Maximum decoded image size accepted, in bytes. */
export const MAX_PROFILE_PHOTO_BYTES = 500 * 1024;

/** Square edge length the client crops to before upload. */
export const PROFILE_PHOTO_DIMENSION = 512;

export interface ParsedImageDataUrl {
  /** Normalised `data:<mime>;base64,<payload>` string. */
  dataUrl: string;
  mime: ProfilePhotoMime;
  /** Decoded byte length. */
  bytes: number;
}

export type ParseImageResult =
  | { ok: true; value: ParsedImageDataUrl }
  | { ok: false; error: string };

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Decoded byte length of a base64 payload without allocating a buffer. */
export function base64ByteLength(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Whether `mime` is one of the accepted profile photo types. */
export function isAllowedPhotoMime(mime: string): mime is ProfilePhotoMime {
  return (PROFILE_PHOTO_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Validate a client-supplied profile photo data URL. Rejects non-image,
 * disallowed MIME types, empty payloads and oversized images.
 */
export function parseImageDataUrl(input: unknown): ParseImageResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "image must be a data URL string." };
  }

  const match = DATA_URL_RE.exec(input);
  if (!match) {
    return {
      ok: false,
      error: `image must be a base64 data URL of type ${PROFILE_PHOTO_MIME_TYPES.join(", ")}.`,
    };
  }

  const mime = match[1] as ProfilePhotoMime;
  const payload = match[2];
  const bytes = base64ByteLength(payload);

  if (bytes === 0) {
    return { ok: false, error: "image is empty." };
  }
  if (bytes > MAX_PROFILE_PHOTO_BYTES) {
    return {
      ok: false,
      error: `image must be at most ${Math.round(MAX_PROFILE_PHOTO_BYTES / 1024)} KB.`,
    };
  }

  return { ok: true, value: { dataUrl: `data:${mime};base64,${payload}`, mime, bytes } };
}
