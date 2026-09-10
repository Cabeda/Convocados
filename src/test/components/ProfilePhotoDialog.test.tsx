import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import { renderWithTheme } from "../render";
import ProfilePhotoDialog from "~/components/ProfilePhotoDialog";
import { readFileAsDataUrl, cropImageToDataUrl } from "~/lib/cropImage";

vi.mock("react-easy-crop", async () => {
  const React = await import("react");
  function CropperMock({
    onCropComplete,
  }: {
    onCropComplete?: (a: unknown, b: unknown) => void;
  }) {
    const completeRef = React.useRef(onCropComplete);
    React.useEffect(() => {
      completeRef.current?.({}, { x: 0, y: 0, width: 100, height: 100 });
    }, []);
    return React.createElement("div", { "data-testid": "cropper" });
  }
  return { default: CropperMock };
});

vi.mock("~/lib/cropImage", () => ({
  readFileAsDataUrl: vi.fn(),
  cropImageToDataUrl: vi.fn(),
}));

const mockRead = vi.mocked(readFileAsDataUrl);
const mockCrop = vi.mocked(cropImageToDataUrl);

const DATA_URL = "data:image/png;base64,AAAA";
const CROPPED = "data:image/webp;base64,CCCC";

function renderDialog(overrides: Partial<ComponentProps<typeof ProfilePhotoDialog>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = renderWithTheme(
    <ProfilePhotoDialog
      open
      currentImage={null}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onSaved };
}

function upload(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue(DATA_URL);
  mockCrop.mockResolvedValue(CROPPED);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfilePhotoDialog", () => {
  it("shows the picker first and no cropper", () => {
    renderDialog();
    expect(screen.getByText("Choose photo")).toBeInTheDocument();
    expect(screen.queryByTestId("cropper")).not.toBeInTheDocument();
  });

  it("rejects a disallowed file type", async () => {
    renderDialog();
    upload(new File(["x"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText("Choose a JPG, PNG or WebP image.")).toBeInTheDocument();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("rejects an oversized file", async () => {
    renderDialog();
    const big = new File([new Uint8Array(600 * 1024)], "big.png", { type: "image/png" });
    upload(big);
    expect(await screen.findByText("Image is too large. Maximum 500 KB.")).toBeInTheDocument();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("moves to the crop stage after a valid file is chosen", async () => {
    renderDialog();
    upload(new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
  });

  it("saves the cropped image", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved, onClose } = renderDialog();
    upload(new File(["x"], "a.png", { type: "image/png" }));
    await screen.findByTestId("cropper");

    await userEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CROPPED));
    expect(mockCrop).toHaveBeenCalledWith(DATA_URL, { x: 0, y: 0, width: 100, height: 100 }, 0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/photo",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server error when saving fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "Nope." }) });
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = renderDialog();
    upload(new File(["x"], "a.png", { type: "image/png" }));
    await screen.findByTestId("cropper");

    await userEvent.click(screen.getByRole("button", { name: "Save photo" }));

    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows an error when cropping fails", async () => {
    mockCrop.mockRejectedValue(new Error("canvas"));
    renderDialog();
    upload(new File(["x"], "a.png", { type: "image/png" }));
    await screen.findByTestId("cropper");

    await userEvent.click(screen.getByRole("button", { name: "Save photo" }));

    expect(
      await screen.findByText("Couldn't save your photo. Please try again."),
    ).toBeInTheDocument();
  });

  it("shows an error when the file cannot be read", async () => {
    mockRead.mockRejectedValue(new Error("read"));
    renderDialog();
    upload(new File(["x"], "a.png", { type: "image/png" }));
    expect(
      await screen.findByText("Couldn't save your photo. Please try again."),
    ).toBeInTheDocument();
  });

  it("removes the current photo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ image: null }) });
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved, onClose } = renderDialog({ currentImage: DATA_URL });

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
    expect(fetchMock).toHaveBeenCalledWith("/api/me/photo", { method: "DELETE" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error when removal fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = renderDialog({ currentImage: DATA_URL });

    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(
      await screen.findByText("Couldn't save your photo. Please try again."),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("offers no remove button when there is no current photo", () => {
    renderDialog({ currentImage: null });
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });
});
