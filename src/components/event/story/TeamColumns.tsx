import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Snackbar, TextField, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import { useLocale } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import type { Imatch } from "~/lib/random";
import { movePlayer } from "~/lib/teams";
import { shortNames } from "~/lib/nextGame";
import { teamTitle } from "~/lib/teamsView";
import { TeamDragGhost, teamMotionKeyframes, useTeamDrag } from "../../team/useTeamDrag";
import { EASE, NUMERAL_FONT, srOnly, tappable } from "./styles";

const CALM = "@media (prefers-reduced-motion: reduce)";
const POSITION_KEYS: Record<string, TranslationKey> = { GK: "positionGk", DEF: "positionDef", MID: "positionMid", FWD: "positionFwd" };

/** Names fade in one after another, so the whole list is in within 400ms (200ms each, the last starting at 200ms). */
/** The two sides keep their place in the page when one is renamed, so they are keyed by side, not by name. */
const SIDE_KEYS = ["one", "two"];
const FADE_MS = 200;
const FADE_STEP_MS = 25;
const FADE_LAST_START_MS = 200;

interface Props {
  matches: Imatch[];
  /** The viewer's team (0 or 1) and the name on their row: highlighted. */
  viewerTeam: number | null;
  viewerName: string | null;
  /** May this viewer move people between teams? */
  canEdit: boolean;
  /** Drag as well as tap: only for a mouse or trackpad, never a thumb. */
  drag: boolean;
  onResultChange: (matches: Imatch[]) => void;
  /** The organizer renames a team; absent for everyone else. */
  onRename?: (teamIndex: number, name: string) => void;
  /** Number beside a name: only passed when the game is balanced and the organizer has not hidden it. */
  ratings?: Record<string, number>;
  /** The Crew each person plays for, only passed when there is a season with stakes. */
  crews?: Record<string, string | null>;
  /** The person's preferred position, only passed when positions are on. */
  positions?: Record<string, string | null | undefined>;
  /** Increment when a new draw lands, to shake the lists once. */
  shuffleKey: number;
  /** The block is unfolding right now: names fade in in turn. */
  reveal: boolean;
}

/**
 * Two flat columns, "Team 1" and "Team 2", with the viewer's own team underlined in the primary colour.
 * A name is its short form ("Ana M.") with the full one for a screen reader and a long press; the one-tap
 * "Move to …" arrow is the way to change teams on a phone, dragging is the extra for a mouse.
 */
export function TeamColumns({ matches, viewerTeam, viewerName, canEdit, drag: dragEnabled, onResultChange, onRename, ratings, crews, positions, shuffleKey, reveal }: Props) {
  const { t } = useLocale();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const penRef = useRef<Array<HTMLButtonElement | null>>([]);
  // The pencil comes back when the field closes; focus goes there, so a keyboard user keeps their place.
  const refocusRef = useRef<number | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(focusTimerRef.current), []);
  useEffect(() => {
    if (editing !== null || refocusRef.current === null) return;
    const index = refocusRef.current;
    refocusRef.current = null;
    // After the key press has finished: a focused pencil would otherwise take the same Enter as a tap and reopen the field.
    focusTimerRef.current = setTimeout(() => penRef.current[index]?.focus(), 0);
  });
  const [undoMove, setUndoMove] = useState<{ message: string; previous: Imatch[]; expected: Imatch[] } | null>(null);

  const { drag, activeDropZone, playerMotion, zonesRef, cancelDrag, handlePointerDown, handlePointerMove, handlePointerUp } =
    useTeamDrag({ matches, onResultChange, shuffleKey });

  const shorts = useMemo(() => {
    const all = matches.flatMap((m) => m.players.map((p) => p.name));
    const map = new Map<string, string>();
    shortNames(all).forEach((s, i) => map.set(all[i], s));
    return map;
  }, [matches]);

  const labelOf = (name: string, index: number) => {
    const title = teamTitle(name, index);
    return title.custom ? title.name : t(index === 0 ? "tbTeam1" : "tbTeam2");
  };

  const move = (name: string, from: string, to: string) => {
    const next = movePlayer(matches, name, from, to);
    if (next === matches) return;
    const toIndex = matches.findIndex((m) => m.team === to);
    setUndoMove({ message: t("playerMovedToTeam", { name: shorts.get(name) ?? name, team: labelOf(to, toIndex) }), previous: matches, expected: next });
    onResultChange(next);
  };

  const save = (index: number, team: string) => {
    const value = draft.trim() || team;
    refocusRef.current = index;
    setEditing(null);
    if (value !== team) onRename?.(index, value);
  };

  let order = 0;
  return (
    <>
      <TeamDragGhost drag={drag} />
      <Box
        data-testid="team-columns" data-shuffle-key={shuffleKey} data-can-edit={canEdit ? "true" : "false"}
        onPointerMove={drag ? handlePointerMove : undefined} onPointerUp={drag ? handlePointerUp : undefined} onPointerCancel={cancelDrag}
        sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 2, mt: 1, ...teamMotionKeyframes }}
      >
        {matches.map((team, index) => {
          const other = matches.length === 2 ? matches.find((m) => m.team !== team.team) : undefined;
          const mine = viewerTeam === index;
          const label = labelOf(team.team, index);
          const dropping = activeDropZone === team.team;
          return (
            <Box
              key={SIDE_KEYS[index] ?? `side-${index}`} role="group" aria-label={label} data-testid="team-col" data-team={team.team} data-viewer-team={mine ? "true" : undefined}
              ref={(el: HTMLElement | null) => { zonesRef.current[team.team] = el; }}
              sx={{ minWidth: 0, borderRadius: 1, bgcolor: dropping ? "action.hover" : "transparent" }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 44, borderBottom: "2px solid", borderColor: mine ? "primary.main" : "divider", pb: 0.25, mb: 0.5 }}>
                {editing === index ? (
                  <>
                    <TextField
                      size="small" value={draft} autoFocus fullWidth
                      onChange={(e) => setDraft(e.target.value.slice(0, 50))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); save(index, team.team); }
                        if (e.key === "Escape") { e.preventDefault(); refocusRef.current = index; setEditing(null); }
                      }}
                      slotProps={{ htmlInput: { maxLength: 50, "aria-label": t("renameTeam", { label }) } }}
                      sx={{ minWidth: 0, "& .MuiInputBase-input": { fontSize: "1rem", py: 1 } }}
                    />
                    <IconButton aria-label={t("tbSaveName")} onClick={() => save(index, team.team)} sx={{ width: 44, height: 44, flex: "none", ...tappable }}><CheckIcon fontSize="small" /></IconButton>
                    <IconButton aria-label={t("cancel")} onClick={() => { refocusRef.current = index; setEditing(null); }} sx={{ width: 44, height: 44, flex: "none", ...tappable }}><CloseIcon fontSize="small" /></IconButton>
                  </>
                ) : (
                  <>
                    <Typography
                      component="span" title={label}
                      sx={{ flex: 1, minWidth: 0, fontFamily: NUMERAL_FONT, fontWeight: 700, fontSize: "1.375rem", lineHeight: 1.2, overflowWrap: "anywhere", color: mine ? "primary.main" : "text.primary" }}
                    >
                      {label}
                    </Typography>
                    {mine && <Box component="span" sx={srOnly}> ({t("ngYouTag")})</Box>}
                    {onRename && (
                      <IconButton
                        ref={(el) => { penRef.current[index] = el; }} aria-label={t("renameTeam", { label })}
                        onClick={() => { setDraft(team.team); setEditing(index); }}
                        sx={{ width: 44, height: 44, flex: "none", mr: -1, color: "text.secondary", ...tappable }}
                      >
                        <EditIcon sx={{ fontSize: "1.125rem" }} />
                      </IconButton>
                    )}
                  </>
                )}
              </Box>
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {team.players.map((player) => {
                  const me = !!viewerName && viewerTeam === index && player.name === viewerName;
                  const short = shorts.get(player.name) ?? player.name;
                  const rating = ratings?.[player.name];
                  const crew = crews?.[player.name];
                  const position = positions?.[player.name];
                  const arriving = playerMotion?.name === player.name && playerMotion.destinationTeam === team.team;
                  const delay = Math.min(order++ * FADE_STEP_MS, FADE_LAST_START_MS);
                  return (
                    <Box
                      component="li" key={player.name} data-testid={`team-player-${player.name}`} data-motion={arriving ? "arriving" : undefined} data-you={me ? "true" : undefined}
                      sx={{
                        display: "flex", alignItems: "center", gap: 0.5, minHeight: canEdit ? 44 : 36, opacity: drag?.name === player.name ? 0.3 : 1,
                        ...(reveal ? { animation: `tbName ${FADE_MS}ms ${EASE} ${delay}ms both`, "@keyframes tbName": { from: { opacity: 0 }, to: { opacity: 1 } }, [CALM]: { animation: "none" } } : {}),
                        ...(arriving ? { animation: "team-player-arrival 650ms cubic-bezier(0.22, 1, 0.36, 1) both" } : {}),
                      }}
                    >
                      <Box title={player.name} sx={{ flex: 1, minWidth: 0, py: 0.25 }}>
                        <Typography component="span" aria-hidden sx={{ display: "block", fontSize: "1rem", lineHeight: 1.4, overflowWrap: "break-word", fontWeight: me ? 700 : 400, color: me ? "primary.main" : "text.primary" }}>
                          {short}
                        </Typography>
                        <Box component="span" sx={srOnly}>{player.name}{me ? ` (${t("ngYouTag")})` : ""}</Box>
                        {(crew || (positions && position && POSITION_KEYS[position])) && (
                          <Typography component="span" sx={{ display: "block", fontSize: "0.875rem", lineHeight: 1.35, color: "text.secondary" }}>
                            {[crew, positions && position && POSITION_KEYS[position] ? t(POSITION_KEYS[position]) : null].filter(Boolean).join(" · ")}
                          </Typography>
                        )}
                      </Box>
                      {rating !== undefined && (
                        <Typography component="span" role="img" aria-label={t("tbRating", { n: Math.round(rating) })} sx={{ fontSize: "0.875rem", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                          {Math.round(rating)}
                        </Typography>
                      )}
                      {canEdit && other && (
                        <IconButton
                          data-testid={`team-player-move-${player.name}`} aria-label={t("movePlayerToTeam", { name: player.name, team: labelOf(other.team, index === 0 ? 1 : 0) })}
                          onClick={() => move(player.name, team.team, other.team)}
                          sx={{ width: 44, height: 44, flex: "none", color: "text.secondary", ...tappable }}
                        >
                          {index === 0 ? <ArrowForwardIcon fontSize="small" /> : <ArrowBackIcon fontSize="small" />}
                        </IconButton>
                      )}
                      {canEdit && dragEnabled && (
                        <Box
                          aria-hidden data-testid={`team-player-handle-${player.name}`} onPointerDown={(e) => handlePointerDown(e, player.name, team.team)}
                          sx={{ display: { xs: "none", sm: "flex" }, p: 0.5, cursor: drag ? "grabbing" : "grab", touchAction: "none", color: "text.disabled" }}
                        >
                          <DragIndicatorIcon fontSize="small" />
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Snackbar
        open={!!undoMove} autoHideDuration={6000} onClose={() => setUndoMove(null)} message={undoMove?.message ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }} sx={{ bottom: { xs: 88, sm: 24 } }}
        action={
          <Button
            color="inherit" size="small" sx={{ minHeight: 44, ...tappable }}
            onClick={() => {
              const undo = undoMove;
              setUndoMove(null);
              if (!undo) return;
              // Only undo if the lineup is still the one the move produced: a draw or another edit in between survives.
              if (JSON.stringify(matches) !== JSON.stringify(undo.expected)) return;
              onResultChange(undo.previous);
            }}
          >
            {t("undoRemove")}
          </Button>
        }
      />
    </>
  );
}
