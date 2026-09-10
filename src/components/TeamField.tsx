import { useMemo, useRef } from "react";
import {
  Box, Chip, Typography, alpha, useTheme, Stack, Avatar,
  Select, MenuItem, FormControl,
} from "@mui/material";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";
import { applyFormationLayout, firstFreeSlot, placePlayer, setFormation } from "~/lib/teams";
import { getDefaultFormation, getFormation, getFormationsForSport } from "~/lib/formations";
import {
  TeamDragGhost,
  teamMotionKeyframes,
  useTeamDrag,
} from "./team/useTeamDrag";

interface Props {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
  ratingsMap?: Record<string, number>;
  /** Increment when a server-side randomization starts to animate the reshuffle. */
  shuffleKey?: number;
  /** Event sport id — drives which formations are offered. */
  sport?: string | null;
}

const TOKEN_TEXT = "#16241b";

/**
 * Field view of the randomized teams. Two halves of a sport pitch, one per
 * team. Each team has a formation whose slots are fixed points on the half;
 * dragging a player onto a slot places (or swaps) them, and dragging across
 * halves moves them between teams.
 */
export function TeamField({
  matches,
  onResultChange,
  ratingsMap,
  shuffleKey = 0,
  sport = null,
}: Props) {
  const theme = useTheme();
  const t = useT();
  const isDark = theme.palette.mode === "dark";

  const TEAM_COLORS = [theme.palette.primary, theme.palette.secondary];
  const formations = getFormationsForSport(sport);
  const slotRefs = useRef<Record<string, HTMLElement | null>>({});

  // Legacy teams may predate formations/slots. Lay them out on the sport's
  // default formation so the pitch renders correctly before any interaction;
  // the first move persists the resolved layout.
  const layout = useMemo(() => applyFormationLayout(matches, sport), [matches, sport]);

  const formationFor = (team: Imatch) =>
    getFormation(sport, team.formation) ?? getDefaultFormation(sport);

  const slotAtPoint = (x: number, y: number): { team: string; slot: number } | null => {
    for (const [key, el] of Object.entries(slotRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const [team, slot] = key.split(":");
        return { team, slot: Number(slot) };
      }
    }
    return null;
  };

  const {
    drag,
    activeDropZone,
    playerMotion,
    isShuffling,
    zonesRef,
    cancelDrag,
    zoneAtPoint,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTeamDrag({
    matches: layout,
    onResultChange,
    shuffleKey,
    resolveMove: (activeDrag, x, y) => {
      const slotHit = slotAtPoint(x, y);
      if (slotHit) {
        const updated = placePlayer(layout, activeDrag.name, activeDrag.team, slotHit.team, slotHit.slot);
        return updated === layout ? null : { updated, destinationTeam: slotHit.team };
      }
      const teamHit = zoneAtPoint(x, y);
      if (!teamHit || teamHit === activeDrag.team) return null;
      const target = layout.find((m) => m.team === teamHit);
      if (!target) return null;
      const slot = firstFreeSlot(target.players, formationFor(target).slots.length) ?? 0;
      const updated = placePlayer(layout, activeDrag.name, activeDrag.team, teamHit, slot);
      return updated === layout ? null : { updated, destinationTeam: teamHit };
    },
  });

  return (
    <>
      <TeamDragGhost drag={drag} />
      <Box
        data-testid="team-field"
        data-shuffling={isShuffling ? "true" : "false"}
        data-dragging={drag ? "true" : "false"}
        data-shuffle-key={shuffleKey}
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: { xs: 0.75, sm: 1.5 },
          p: { xs: 0.75, sm: 1.5 },
          borderRadius: 3,
          overflow: "hidden",
          background: isDark
            ? "linear-gradient(160deg, #16351f 0%, #102618 100%)"
            : "linear-gradient(160deg, #2f8f4e 0%, #246f3d 100%)",
          border: `1px solid ${alpha(theme.palette.common.black, 0.25)}`,
          "&::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: `2px solid ${alpha("#ffffff", isDark ? 0.25 : 0.35)}`,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          },
          ...teamMotionKeyframes,
        }}
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={cancelDrag}
      >
        <Box
          aria-hidden
          data-testid="field-center-line"
          sx={{
            position: "absolute",
            top: "4%",
            bottom: "4%",
            left: "50%",
            width: 2,
            bgcolor: alpha("#ffffff", isDark ? 0.25 : 0.35),
            pointerEvents: "none",
          }}
        />
        {layout.map((team, teamIdx) => {
          const colors = TEAM_COLORS[teamIdx % TEAM_COLORS.length];
          const isActive = activeDropZone === team.team;
          const n = team.players.length;
          const accentColor = colors.main;
          const formation = formationFor(team);
          const slotCount = formation.slots.length;
          const isPlaced = (p: Imatch["players"][number]) =>
            typeof p.slot === "number" && p.slot < slotCount;
          const placed = team.players.filter(isPlaced);
          const unplaced = team.players.filter((p) => !isPlaced(p));
          const teamAvgElo = ratingsMap && n > 0
            ? Math.round(team.players.reduce((sum, p) => sum + (ratingsMap[p.name] ?? 1000), 0) / n)
            : null;
          const slotPlayer = (slotIdx: number) => placed.find((p) => p.slot === slotIdx);

          const tokenPosition = (slotIdx: number) => {
            const slot = formation.slots[slotIdx];
            const left = (teamIdx === 0 ? slot.x : 1 - slot.x) * 100;
            return { left: `${left}%`, top: `${slot.y * 100}%` };
          };

          const renderToken = (
            player: Imatch["players"][number],
            index: number,
            slotIdx: number | null,
          ) => {
            const isBeingDragged = drag?.name === player.name && drag?.team === team.team;
            const isArriving = playerMotion?.name === player.name
              && playerMotion.destinationTeam === team.team;
            return (
              <Box
                key={player.name}
                data-testid={`field-player-${player.name}`}
                data-motion={isArriving ? "arriving" : undefined}
                ref={slotIdx !== null
                  ? (el: HTMLElement | null) => { slotRefs.current[`${team.team}:${slotIdx}`] = el; }
                  : undefined}
                onPointerDown={(e) => handlePointerDown(e, player.name, team.team)}
                sx={{
                  ...(slotIdx !== null
                    ? { position: "absolute", ...tokenPosition(slotIdx), transform: "translate(-50%, -50%)", maxWidth: "46%" }
                    : { maxWidth: "100%" }),
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  pl: 0.5,
                  pr: 1,
                  py: 0.4,
                  borderRadius: 5,
                  bgcolor: "#f7fbf8",
                  color: TOKEN_TEXT,
                  boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.5)" : 2,
                  cursor: drag ? "grabbing" : "grab",
                  touchAction: "none",
                  userSelect: "none",
                  zIndex: isBeingDragged ? 0 : 2,
                  opacity: isBeingDragged ? 0.3 : 1,
                  transition: "opacity 0.15s, box-shadow 0.15s",
                  "&:hover": { boxShadow: 4 },
                  animation: isArriving
                    ? "team-player-arrival 650ms cubic-bezier(0.22, 1, 0.36, 1) both"
                    : undefined,
                }}
              >
                <Avatar
                  sx={{
                    width: 20,
                    height: 20,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    bgcolor: alpha(accentColor, isDark ? 0.35 : 0.18),
                    color: isDark ? "#ffffff" : TOKEN_TEXT,
                  }}
                >
                  {index + 1}
                </Avatar>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  noWrap
                  sx={{ fontSize: "0.78rem", color: TOKEN_TEXT }}
                >
                  {player.name}
                </Typography>
                {ratingsMap && (
                  <Typography
                    variant="caption"
                    sx={{ color: "rgba(0,0,0,0.55)", fontWeight: 700, fontSize: "0.68rem" }}
                  >
                    {Math.round(ratingsMap[player.name] ?? 1000)}
                  </Typography>
                )}
              </Box>
            );
          };

          return (
            <Box
              key={team.team}
              data-testid="field-half"
              data-team={team.team}
              ref={(el: HTMLElement | null) => { zonesRef.current[team.team] = el; }}
              sx={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
                p: { xs: 0.75, sm: 1.25 },
                borderRadius: 2,
                border: isActive
                  ? "2px solid #ffffff"
                  : drag
                    ? `2px dashed ${alpha("#ffffff", 0.4)}`
                    : `2px solid ${alpha("#ffffff", 0.15)}`,
                bgcolor: isActive ? alpha("#ffffff", 0.18) : alpha("#ffffff", 0.05),
                transition: "border-color 0.2s, background-color 0.2s",
              }}
            >
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  noWrap
                  sx={{ color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
                >
                  {team.team}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
                  <Chip
                    label={n === 1 ? t("playerCount", { n }) : t("playerCountPlural", { n })}
                    size="small"
                    sx={{
                      bgcolor: alpha("#ffffff", 0.22),
                      color: "#ffffff",
                      fontWeight: 600,
                      fontSize: "0.7rem",
                      height: 22,
                    }}
                  />
                  {teamAvgElo !== null && (
                    <Chip
                      data-testid={`field-half-elo-${team.team}`}
                      label={`Elo ${teamAvgElo}`}
                      size="small"
                      sx={{
                        bgcolor: alpha("#ffffff", 0.22),
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: "0.7rem",
                        height: 22,
                      }}
                    />
                  )}
                </Stack>
              </Stack>

              {formations.length > 1 && (
                <FormControl size="small" variant="standard" sx={{ minWidth: 84 }}>
                  <Select
                    data-testid={`field-formation-${team.team}`}
                    value={formation.id}
                    onChange={(e) => {
                      const next = getFormation(sport, e.target.value);
                      if (!next) return;
                      onResultChange(setFormation(layout, team.team, next.id, next.slots.length));
                    }}
                    disableUnderline
                    inputProps={{ "aria-label": t("formation") }}
                    sx={{
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      bgcolor: alpha("#ffffff", 0.18),
                      borderRadius: 1,
                      px: 1,
                      "& .MuiSelect-select": { py: 0.4 },
                      "& .MuiSvgIcon-root": { color: "#ffffff" },
                    }}
                  >
                    {formations.map((f) => (
                      <MenuItem key={f.id} value={f.id} sx={{ fontWeight: 600 }}>
                        {f.id}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <Box
                sx={{
                  position: "relative",
                  flex: 1,
                  minHeight: { xs: 150, sm: 190 },
                  animation: isShuffling
                    ? "team-player-shuffle 700ms cubic-bezier(0.22, 1, 0.36, 1) both"
                    : undefined,
                  animationDelay: isShuffling ? `${teamIdx * 55}ms` : undefined,
                }}
              >
                {formation.slots.map((_, slotIdx) => {
                  const occupant = slotPlayer(slotIdx);
                  if (occupant) return renderToken(occupant, slotIdx, slotIdx);
                  return (
                    <Box
                      key={`slot-${slotIdx}`}
                      data-testid={`field-slot-${team.team}-${slotIdx}`}
                      ref={(el: HTMLElement | null) => { slotRefs.current[`${team.team}:${slotIdx}`] = el; }}
                      sx={{
                        position: "absolute",
                        ...tokenPosition(slotIdx),
                        transform: "translate(-50%, -50%)",
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        border: `1.5px dashed ${alpha("#ffffff", 0.5)}`,
                        bgcolor: alpha("#ffffff", 0.08),
                      }}
                    />
                  );
                })}
              </Box>

              {unplaced.length > 0 && (
                <Box
                  data-testid={`field-unplaced-${team.team}`}
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 0.5,
                    pt: 0.5,
                    borderTop: `1px dashed ${alpha("#ffffff", 0.25)}`,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: alpha("#ffffff", 0.7), fontWeight: 600, mr: 0.5 }}
                  >
                    {t("unplacedPlayers")}
                  </Typography>
                  {unplaced.map((p, i) => renderToken(p, i, null))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );
}
