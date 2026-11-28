import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { useT } from "~/lib/useT";
import { SLOT_GAP, SLOT_MAX_SIZE, slotColumns, slotLabels, slotMinSize } from "~/lib/nextGame";
import type { Player } from "../types";
import { EASE, controlBorder, focusRing, pressable } from "./styles";

const CALM = "@media (prefers-reduced-motion: reduce)";

/** Names that appeared after the first paint — only those slots animate in. */
function useFreshNames(names: readonly string[]): ReadonlySet<string> {
  const [known, setKnown] = useState(() => new Set(names));
  const fresh = names.filter((n) => !known.has(n));
  const freshKey = JSON.stringify(fresh);
  const allKey = JSON.stringify(names);
  // A new name keeps its entrance for a little longer than the 180ms it takes, then counts as known.
  useEffect(() => {
    if (freshKey === "[]") return;
    const id = setTimeout(() => setKnown((k) => new Set([...k, ...(JSON.parse(allKey) as string[])])), 400);
    return () => clearTimeout(id);
  }, [freshKey, allKey]);
  return new Set(fresh);
}

interface Props {
  /** The playing roster: at most `maxPlayers` rows, in order. */
  players: readonly Player[];
  maxPlayers: number;
  viewerId: string | null;
  /** Rows the viewer may tap for options (remove). */
  canPress?: (player: Player) => boolean;
  selectedId?: string | null;
  onPress?: (player: Player) => void;
  /** Tapping an open spot opens "Add a friend". The button next to the lineup is the real control. */
  onOpenSpot?: () => void;
  /** Id of the options row a pressed slot controls. */
  controlsId?: string;
  /** The options of the selected slot: they open in the grid itself, right under the row of the slot that was tapped. */
  options?: ReactNode;
}

/**
 * One slot per place in the game: initials in a circle when taken, a dashed ring when open.
 * The viewer's own slot is in the primary colour. Two people who would show the same letters
 * get more of their name. The grid balances its rows (10 → 5 + 5) and never makes a slot smaller
 * than 36px — widths and wrapping are checked in a real browser, not in jsdom.
 */
export function LineupSlots({ players, maxPlayers, viewerId, canPress, selectedId, onPress, onOpenSpot, controlsId, options }: Props) {
  const t = useT();
  const fresh = useFreshNames(players.map((p) => p.name));
  const { labels } = slotLabels(players.map((p) => p.name));
  const columns = slotColumns(maxPlayers);
  const min = slotMinSize(maxPlayers);
  // Aim for `columns` per row, but never below the minimum size: a narrow screen takes fewer and wraps.
  const track = `max(${min}px, calc((100% - ${(columns - 1) * SLOT_GAP}px) / ${columns} - 0.5px))`;

  return (
    <Box
      role="group" aria-label={t("ngLineupAria", { n: players.length, max: maxPlayers })} data-testid="lineup-slots"
      sx={{
        // "dense": the options span a whole row, and the slots after the tapped one fill the rest of its row.
        display: "grid", gridAutoFlow: "row dense", gridTemplateColumns: `repeat(auto-fill, minmax(${track}, 1fr))`, gap: `${SLOT_GAP}px`,
        maxWidth: columns * SLOT_MAX_SIZE + (columns - 1) * SLOT_GAP,
      }}
    >
      {Array.from({ length: maxPlayers }, (_, i) => {
        const player = players[i] ?? null;
        if (!player) {
          return (
            <Box
              key={`open-${i}`} aria-hidden data-testid="open-slot" onClick={onOpenSpot}
              sx={{ aspectRatio: "1", borderRadius: "50%", border: "1.5px dashed", borderColor: controlBorder, boxSizing: "border-box", cursor: onOpenSpot ? "pointer" : "default" }}
            />
          );
        }
        const me = !!viewerId && player.userId === viewerId;
        const pressable_ = !!onPress && !!canPress?.(player);
        const selected = selectedId === player.id;
        const name = me ? `${player.name} (${t("ngYouTag")})` : player.name;
        return (
          <Fragment key={`slot-${i}`}>
          <Box
            component={pressable_ ? "button" : "div"}
            {...(pressable_
              ? { type: "button", onClick: () => onPress?.(player), "aria-expanded": selected, ...(controlsId ? { "aria-controls": controlsId } : {}) }
              : { role: "img" })}
            aria-label={pressable_ ? t("ngOptionsFor", { name }) : name} title={player.name} data-testid={me ? "slot-me" : "slot"} data-trigger={`slot:${player.id}`}
            sx={{
              all: pressable_ ? "unset" : undefined, boxSizing: "border-box", position: "relative", aspectRatio: "1", borderRadius: "50%",
              display: "grid", placeItems: "center", minWidth: 0, fontSize: "0.8125rem", fontWeight: 700, lineHeight: 1, letterSpacing: "0.01em",
              bgcolor: me ? "primary.main" : "action.selected", color: me ? "primary.contrastText" : "text.primary",
              outline: selected ? "2px solid" : "none", outlineColor: "primary.main", outlineOffset: "2px",
              ...(pressable_ ? { cursor: "pointer", ...pressable, ...focusRing, "&::after": { content: '""', position: "absolute", inset: -4, borderRadius: "50%" } } : {}),
              ...(fresh.has(player.name) ? {
                animation: `ngSlotIn 180ms ${EASE}`,
                "@keyframes ngSlotIn": { from: { transform: "scale(0.6)", opacity: 0 }, to: { transform: "scale(1)", opacity: 1 } },
                [CALM]: { animation: "none" },
              } : {}),
            }}
          >
            <span aria-hidden>{labels[i]}</span>
          </Box>
          {selected && options && <Box data-testid="slot-options-row" sx={{ gridColumn: "1 / -1" }}>{options}</Box>}
          </Fragment>
        );
      })}
    </Box>
  );
}
