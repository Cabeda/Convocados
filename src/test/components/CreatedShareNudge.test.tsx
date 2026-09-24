/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { CreatedShareNudge } from "~/components/event/CreatedShareNudge";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubLocation(search: string) {
  delete (window as any).location;
  (window as any).location = {
    href: `http://localhost/events/abc${search}`,
    origin: "http://localhost",
    pathname: "/events/abc",
    search,
  };
}

describe("CreatedShareNudge", () => {
  it("opens the share dialog with the event URL when ?created=1", () => {
    stubLocation("?created=1");
    const spy = vi.spyOn(window.history, "replaceState");
    renderWithTheme(<CreatedShareNudge title="Sunday Football" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("http://localhost/events/abc")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(null, "", "/events/abc");
  });

  it("closes the dialog and stays closed", () => {
    stubLocation("?created=1");
    renderWithTheme(<CreatedShareNudge title="Sunday Football" />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing without the param", () => {
    stubLocation("");
    renderWithTheme(<CreatedShareNudge title="Sunday Football" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
