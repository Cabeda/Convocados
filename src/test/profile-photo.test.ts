import { describe, it, expect } from "vitest";
import {
  base64ByteLength,
  isAllowedPhotoMime,
  parseImageDataUrl,
  MAX_PROFILE_PHOTO_BYTES,
} from "~/lib/profilePhoto";

describe("base64ByteLength", () => {
  it("returns 0 for an empty payload", () => {
    expect(base64ByteLength("")).toBe(0);
  });

  it("accounts for padding", () => {
    expect(base64ByteLength("A")).toBe(0);
    expect(base64ByteLength("AA")).toBe(1);
    expect(base64ByteLength("AAA")).toBe(2);
    expect(base64ByteLength("AAAA")).toBe(3);
    expect(base64ByteLength("AA==")).toBe(1);
    expect(base64ByteLength("AAA=")).toBe(2);
  });
});

describe("isAllowedPhotoMime", () => {
  it("accepts jpeg, png and webp", () => {
    expect(isAllowedPhotoMime("image/jpeg")).toBe(true);
    expect(isAllowedPhotoMime("image/png")).toBe(true);
    expect(isAllowedPhotoMime("image/webp")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowedPhotoMime("image/gif")).toBe(false);
    expect(isAllowedPhotoMime("image/svg+xml")).toBe(false);
    expect(isAllowedPhotoMime("text/plain")).toBe(false);
    expect(isAllowedPhotoMime("")).toBe(false);
  });
});

describe("parseImageDataUrl", () => {
  it("accepts a valid PNG data URL", () => {
    const result = parseImageDataUrl("data:image/png;base64,AAAA");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mime).toBe("image/png");
    expect(result.value.bytes).toBe(3);
    expect(result.value.dataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("accepts JPEG and WebP data URLs", () => {
    expect(parseImageDataUrl("data:image/jpeg;base64,AAAA").ok).toBe(true);
    expect(parseImageDataUrl("data:image/webp;base64,AAAA").ok).toBe(true);
  });

  it("rejects non-string input", () => {
    for (const input of [undefined, null, 42, {}, ["data:image/png;base64,AAAA"]]) {
      const result = parseImageDataUrl(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an empty string", () => {
    const result = parseImageDataUrl("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("data URL");
  });

  it("rejects disallowed MIME types", () => {
    for (const url of [
      "data:image/gif;base64,AAAA",
      "data:image/svg+xml;base64,AAAA",
      "data:text/plain;base64,AAAA",
      "data:image/png,AAAA",
    ]) {
      const result = parseImageDataUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an empty payload", () => {
    const result = parseImageDataUrl("data:image/png;base64,A");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("empty");
  });

  it("rejects images larger than the limit", () => {
    const payload = "A".repeat(700_000);
    expect(base64ByteLength(payload)).toBeGreaterThan(MAX_PROFILE_PHOTO_BYTES);
    const result = parseImageDataUrl(`data:image/png;base64,${payload}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("KB");
  });

  it("accepts an image exactly at the limit", () => {
    // 512 KB = 524288 bytes. base64 length for that payload is 699052 chars.
    const payload = "A".repeat(Math.ceil((MAX_PROFILE_PHOTO_BYTES / 3) * 4));
    const result = parseImageDataUrl(`data:image/png;base64,${payload}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bytes).toBeLessThanOrEqual(MAX_PROFILE_PHOTO_BYTES);
  });
});
