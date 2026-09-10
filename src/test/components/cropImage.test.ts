import { describe, it, expect, afterEach, vi } from "vitest";
import {
  rotateSize,
  readFileAsDataUrl,
  loadImage,
  canvasToDataUrl,
  cropImageToDataUrl,
} from "~/lib/cropImage";

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 800;
  height = 600;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

class BrokenImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

function stubCanvas(options: { webp?: boolean; context?: boolean } = {}) {
  const drawImage = vi.fn();
  const translate = vi.fn();
  const rotate = vi.fn();
  const ctx = { drawImage, translate, rotate } as unknown as CanvasRenderingContext2D;
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue((options.context === false ? null : ctx) as never);
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation((type?: string) => {
      if (type === "image/webp" && options.webp !== false) return "data:image/webp;base64,AAAA";
      return "data:image/jpeg;base64,BBBB";
    });
  return { ctx, getContext, toDataURL };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rotateSize", () => {
  it("returns the original size at 0 degrees", () => {
    expect(rotateSize(800, 600, 0)).toEqual({ width: 800, height: 600 });
  });

  it("swaps width and height at 90 degrees", () => {
    const result = rotateSize(800, 600, 90);
    expect(Math.round(result.width)).toBe(600);
    expect(Math.round(result.height)).toBe(800);
  });
});

describe("readFileAsDataUrl", () => {
  it("reads a file into a data URL", async () => {
    const file = new File(["hello"], "a.png", { type: "image/png" });
    const result = await readFileAsDataUrl(file);
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects when reading fails with an error", async () => {
    const original = globalThis.FileReader;
    class FailingReader {
      onerror: ((e?: unknown) => void) | null = null;
      onload: (() => void) | null = null;
      error: unknown = new Error("boom");
      result: string | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.(this.error));
      }
    }
    vi.stubGlobal("FileReader", FailingReader);
    await expect(readFileAsDataUrl(new Blob())).rejects.toThrow("boom");
    vi.stubGlobal("FileReader", original);
  });

  it("rejects with a fallback error when none is provided", async () => {
    const original = globalThis.FileReader;
    class FailingReader {
      onerror: ((e?: unknown) => void) | null = null;
      onload: (() => void) | null = null;
      error: unknown = null;
      result: string | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.(null));
      }
    }
    vi.stubGlobal("FileReader", FailingReader);
    await expect(readFileAsDataUrl(new Blob())).rejects.toThrow("Could not read the image.");
    vi.stubGlobal("FileReader", original);
  });
});

describe("loadImage", () => {
  it("resolves once the image loads", async () => {
    vi.stubGlobal("Image", LoadedImage);
    const image = await loadImage("data:image/png;base64,AAAA");
    expect(image.width).toBe(800);
  });

  it("rejects when the image fails to load", async () => {
    vi.stubGlobal("Image", BrokenImage);
    await expect(loadImage("bad")).rejects.toThrow("Could not load the image.");
  });
});

describe("canvasToDataUrl", () => {
  it("prefers WebP", () => {
    stubCanvas();
    const canvas = document.createElement("canvas");
    expect(canvasToDataUrl(canvas)).toBe("data:image/webp;base64,AAAA");
  });

  it("falls back to JPEG when WebP is unsupported", () => {
    stubCanvas({ webp: false });
    const canvas = document.createElement("canvas");
    expect(canvasToDataUrl(canvas)).toBe("data:image/jpeg;base64,BBBB");
  });
});

describe("cropImageToDataUrl", () => {
  it("crops and exports a data URL", async () => {
    vi.stubGlobal("Image", LoadedImage);
    const { ctx } = stubCanvas();
    const result = await cropImageToDataUrl(
      "data:image/png;base64,AAAA",
      { x: 0, y: 0, width: 100, height: 100 },
      90,
    );
    expect(result).toBe("data:image/webp;base64,AAAA");
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("throws when the canvas context is unavailable", async () => {
    vi.stubGlobal("Image", LoadedImage);
    stubCanvas({ context: false });
    await expect(
      cropImageToDataUrl("data:image/png;base64,AAAA", { x: 0, y: 0, width: 10, height: 10 }),
    ).rejects.toThrow("Canvas is not supported in this browser.");
  });

  it("propagates image load failures", async () => {
    vi.stubGlobal("Image", BrokenImage);
    stubCanvas();
    await expect(
      cropImageToDataUrl("bad", { x: 0, y: 0, width: 10, height: 10 }),
    ).rejects.toThrow("Could not load the image.");
  });
});
