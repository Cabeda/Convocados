import { describe, expect, it, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { SeasonDifficultyPrototype } from "~/components/SeasonDifficultyPrototype";
import {
  PROTOTYPE_VARIANTS,
  PrototypeVariantSwitcher,
  usePrototypeVariant,
} from "~/components/PrototypeVariantSwitcher";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllEnvs();
});

function Harness() {
  const [variant, setVariant] = usePrototypeVariant();
  return <button onClick={() => setVariant("B")}>{variant}</button>;
}

describe("PrototypeVariantSwitcher", () => {
  it("exposes the variants in order", () => {
    expect(PROTOTYPE_VARIANTS).toEqual(["A", "B", "C"]);
  });

  it("cycles variants with the arrows and keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithTheme(
      <PrototypeVariantSwitcher current="A" onChange={onChange} labels={{ A: "Compact strip" }} />,
    );
    expect(screen.getByText("A · Compact strip")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Next variant"));
    expect(onChange).toHaveBeenLastCalledWith("B");

    await user.click(screen.getByLabelText("Previous variant"));
    expect(onChange).toHaveBeenLastCalledWith("C");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("B");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("C");
  });

  it("ignores arrow keys while typing in a field", () => {
    const onChange = vi.fn();
    renderWithTheme(<PrototypeVariantSwitcher current="A" onChange={onChange} />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(onChange).not.toHaveBeenCalled();
    input.remove();
  });

  it("renders nothing in production builds", () => {
    vi.stubEnv("PROD", true);
    renderWithTheme(<PrototypeVariantSwitcher current="A" onChange={() => {}} />);
    expect(screen.queryByText("PROTOTYPE")).not.toBeInTheDocument();
  });
});

describe("usePrototypeVariant", () => {
  it("reads the variant from ?variant=", () => {
    window.history.replaceState({}, "", "/?variant=C");
    renderWithTheme(<Harness />);
    expect(screen.getByRole("button")).toHaveTextContent("C");
  });

  it("falls back to A for an unknown variant", () => {
    window.history.replaceState({}, "", "/?variant=Z");
    renderWithTheme(<Harness />);
    expect(screen.getByRole("button")).toHaveTextContent("A");
  });

  it("writes the variant back to the URL", async () => {
    renderWithTheme(<Harness />);
    await userEvent.click(screen.getByRole("button"));
    expect(new URL(window.location.href).searchParams.get("variant")).toBe("B");
    expect(screen.getByRole("button")).toHaveTextContent("B");
  });
});

describe("SeasonDifficultyPrototype", () => {
  it("renders variant A by default", () => {
    renderWithTheme(<SeasonDifficultyPrototype variant="A" />);
    expect(screen.getByText(/of your events/i)).toBeInTheDocument();
  });

  it("renders variant B", () => {
    renderWithTheme(<SeasonDifficultyPrototype variant="B" />);
    expect(screen.getByText("How this event stacks up")).toBeInTheDocument();
    expect(screen.getByText("You're here")).toBeInTheDocument();
  });

  it("renders variant C and lets you change the comparison event", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SeasonDifficultyPrototype variant="C" />);
    expect(screen.getByText("Difficulty ladder")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Sunday Casual" }));
    expect(screen.getByText(/skill easier/)).toBeInTheDocument();
  });
});
