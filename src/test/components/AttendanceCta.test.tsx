import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { AttendanceCta } from "~/components/event/AttendanceCta";

afterEach(() => cleanup());

describe("AttendanceCta", () => {
  const onGoing = vi.fn();
  const onNotComing = vi.fn();

  beforeEach(() => {
    onGoing.mockClear();
    onNotComing.mockClear();
  });

  it("renders the two buttons with the correct labels when the user is on the list", () => {
    renderWithTheme(
      <AttendanceCta
        myRsvpStatus={null}
        isOnList
        onGoing={onGoing}
        onNotComing={onNotComing}
      />,
    );
    expect(screen.getByTestId("attendance-cta")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-cta-going")).toHaveTextContent(/going/i);
    expect(screen.getByTestId("attendance-cta-not-coming")).toHaveTextContent(/not coming/i);
  });

  it("renders 'Join this game' copy on the Going button when the user is NOT on the list", () => {
    renderWithTheme(
      <AttendanceCta
        myRsvpStatus={null}
        isOnList={false}
        onGoing={onGoing}
        onNotComing={onNotComing}
      />,
    );
    expect(screen.getByTestId("attendance-cta-going")).toHaveTextContent(/join/i);
  });

  it("calls onGoing when the Going button is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <AttendanceCta myRsvpStatus={null} isOnList onGoing={onGoing} onNotComing={onNotComing} />,
    );
    await user.click(screen.getByTestId("attendance-cta-going"));
    expect(onGoing).toHaveBeenCalledTimes(1);
  });

  it("calls onNotComing when the Not Coming button is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <AttendanceCta myRsvpStatus={null} isOnList onGoing={onGoing} onNotComing={onNotComing} />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    expect(onNotComing).toHaveBeenCalledTimes(1);
  });

  it("disables the Going button when status is 'yes'", () => {
    renderWithTheme(
      <AttendanceCta myRsvpStatus="yes" isOnList onGoing={onGoing} onNotComing={onNotComing} />,
    );
    expect(screen.getByTestId("attendance-cta-going")).toBeDisabled();
    expect(screen.getByTestId("attendance-cta-not-coming")).not.toBeDisabled();
  });

  it("disables both buttons when busy", () => {
    renderWithTheme(
      <AttendanceCta
        myRsvpStatus="yes"
        isOnList
        onGoing={onGoing}
        onNotComing={onNotComing}
        busy
      />,
    );
    expect(screen.getByTestId("attendance-cta-going")).toBeDisabled();
    expect(screen.getByTestId("attendance-cta-not-coming")).toBeDisabled();
  });

  it("shows the 'not on list' hint when the user is NOT on the list AND has a recorded status", () => {
    renderWithTheme(
      <AttendanceCta
        myRsvpStatus="no"
        isOnList={false}
        onGoing={onGoing}
        onNotComing={onNotComing}
      />,
    );
    expect(screen.getByTestId("attendance-cta-hint")).toBeInTheDocument();
  });

  it("does NOT show the hint when the user IS on the list", () => {
    renderWithTheme(
      <AttendanceCta
        myRsvpStatus="no"
        isOnList
        onGoing={onGoing}
        onNotComing={onNotComing}
      />,
    );
    expect(screen.queryByTestId("attendance-cta-hint")).toBeNull();
  });
});
