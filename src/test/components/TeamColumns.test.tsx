import { cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { TeamColumns } from "~/components/event/story/TeamColumns";
import type { Imatch } from "~/lib/random";

const initial: Imatch[] = [
  { team: "Blue", players: [{ name: "Alice Jones", order: 0 }] },
  { team: "Red", players: [{ name: "Bob Smith", order: 0 }] },
];

function Harness({ canEdit = true, drag = false, onChange, start = initial }: { canEdit?: boolean; drag?: boolean; onChange?: (m: Imatch[]) => void; start?: Imatch[] }) {
  const [matches, setMatches] = useState(start);
  return (
    <>
      <button onClick={() => setMatches([{ team: "Blue", players: [] }, { team: "Red", players: [{ name: "Bob Smith", order: 0 }, { name: "Alice Jones", order: 1 }, { name: "Cara Dee", order: 2 }] }])}>newer-lineup</button>
      <TeamColumns
        matches={matches} viewerTeam={null} viewerName={null} canEdit={canEdit} drag={drag} shuffleKey={0} reveal={false}
        onResultChange={(m) => { setMatches(m); onChange?.(m); }}
      />
    </>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("TeamColumns — dragging (a mouse only)", () => {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 100, width: right - left, height: 100, x: left, y: 0, toJSON: () => ({}) });

  it("marks a person as arriving when dropped on the other column", () => {
    const onChange = vi.fn();
    render(<Harness drag onChange={onChange} />);
    const cols = screen.getAllByTestId("team-col");
    vi.spyOn(cols[0], "getBoundingClientRect").mockReturnValue(rect(0, 100));
    vi.spyOn(cols[1], "getBoundingClientRect").mockReturnValue(rect(101, 200));
    fireEvent.pointerDown(screen.getByTestId("team-player-handle-Alice Jones"), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId("team-columns"), { pointerId: 1, clientX: 150, clientY: 50 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("team-player-Alice Jones")).toHaveAttribute("data-motion", "arriving");
  });

  it("does not move anyone when read-only, and shows no handle", () => {
    render(<Harness drag canEdit={false} />);
    expect(screen.queryByTestId("team-player-handle-Alice Jones")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });
});

describe("TeamColumns — one tap", () => {
  it("moves in one tap and undoes it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Alice Jones to Red" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const moved = onChange.mock.calls[0][0] as Imatch[];
    expect(moved[0].players).toEqual([]);
    expect(moved[1].players.map((p) => p.name)).toEqual(["Bob Smith", "Alice Jones"]);
    expect(screen.getByText("Alice J. moved to Red")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Undo"));
    expect(onChange.mock.calls[1][0]).toEqual(initial);
  });

  it("drops a stale undo instead of reverting a newer change", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move Alice Jones to Red" }));
    fireEvent.click(screen.getByText("newer-lineup"));
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByTestId("team-player-Cara Dee")).toBeInTheDocument();
    expect(screen.getByTestId("team-player-Alice Jones")).toBeInTheDocument();
  });
});

function render(ui: React.ReactElement) { return renderWithTheme(ui); }

describe("TeamColumns — the line under a name", () => {
  const show = (crews: Record<string, string | null>) =>
    renderWithTheme(
      <TeamColumns
        matches={initial} viewerTeam={null} viewerName={null} canEdit={false} drag={false} shuffleKey={0} reveal={false}
        onResultChange={() => {}} crews={crews}
      />,
    );

  it("says a person's crew under their name when it tells something the column heading does not", () => {
    show({ "Alice Jones": "The Owls", "Bob Smith": null });
    expect(screen.getByTestId("team-player-Alice Jones")).toHaveTextContent("The Owls");
    expect(screen.getByTestId("team-player-Bob Smith")).not.toHaveTextContent("The Owls");
  });

  it("leaves it out when the crew is called what the column is called (it would only repeat the heading)", () => {
    show({ "Alice Jones": "blue", "Bob Smith": "RED" });
    expect(screen.getByTestId("team-player-Alice Jones")).not.toHaveTextContent(/blue/i);
    expect(screen.getByTestId("team-player-Bob Smith")).not.toHaveTextContent(/red/i);
  });
});

describe("TeamColumns — renaming a team", () => {
  const stock: Imatch[] = [
    { team: "Ninjas", players: [{ name: "Alice Jones", order: 0 }] },
    { team: "Gunas", players: [{ name: "Bob Smith", order: 0 }] },
  ];
  const custom: Imatch[] = [
    { team: "Lions", players: [{ name: "Alice Jones", order: 0 }] },
    { team: "Gunas", players: [{ name: "Bob Smith", order: 0 }] },
  ];
  const open = (matches: Imatch[], onRename = vi.fn()) => {
    render(
      <TeamColumns
        matches={matches} viewerTeam={null} viewerName={null} canEdit drag={false} shuffleKey={0} reveal={false}
        onResultChange={() => {}} onRename={onRename}
      />,
    );
    return onRename;
  };
  const field = (label: string) => screen.getByRole("textbox", { name: `Rename ${label}` }) as HTMLInputElement;

  it("prefills the name the column shows, not the stored stock name", () => {
    open(stock);
    fireEvent.click(screen.getByRole("button", { name: "Rename Team 1" }));
    expect(field("Team 1").value).toBe("Team 1");
  });

  it("prefills a custom name as it is shown", () => {
    open(custom);
    fireEvent.click(screen.getByRole("button", { name: "Rename Lions" }));
    expect(field("Lions").value).toBe("Lions");
  });

  it("saving the shown name unchanged changes nothing (the stock name is not written)", () => {
    const onRename = open(stock);
    fireEvent.click(screen.getByRole("button", { name: "Rename Team 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rename Team 2" }));
    fireEvent.keyDown(field("Team 2"), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("saving a new name renames that side, trimmed", () => {
    const onRename = open(stock);
    fireEvent.click(screen.getByRole("button", { name: "Rename Team 2" }));
    fireEvent.change(field("Team 2"), { target: { value: "  Wolves " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenCalledExactlyOnceWith(1, "Wolves");
  });

  it("saving it empty puts a custom name back to the default", () => {
    const onRename = open(custom);
    fireEvent.click(screen.getByRole("button", { name: "Rename Lions" }));
    fireEvent.change(field("Lions"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).toHaveBeenCalledExactlyOnceWith(0, "Ninjas");
  });

  it("saving it empty on a team that already has the default changes nothing", () => {
    const onRename = open(stock);
    fireEvent.click(screen.getByRole("button", { name: "Rename Team 1" }));
    fireEvent.change(field("Team 1"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRename).not.toHaveBeenCalled();
  });
});
