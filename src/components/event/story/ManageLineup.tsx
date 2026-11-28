import { useState, type DragEvent } from "react";
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useT } from "~/lib/useT";
import { splitRoster } from "~/lib/rosterCapacity";
import type { Player } from "../types";
import { AnonymousPlayerIcon, PlayerAvatar } from "../PlayerIdentity";
import { tappable } from "./styles";

const POSITIONS = [["", "positionNone"], ["GK", "positionGk"], ["DEF", "positionDef"], ["MID", "positionMid"], ["FWD", "positionFwd"]] as const;

interface Props {
  players: readonly Player[];
  maxPlayers: number;
  positionsEnabled: boolean;
  /** Move one person: by a step (the arrows) or to a place (a drag). The page works out the new order from the latest one. */
  onMove: (playerId: string, target: { by: number } | { to: number }) => void;
  onResetOrder: () => void;
  onSetPosition: (name: string, position: string | null) => void;
  onRemove: (player: Player) => void;
  error: string | null;
  onDismissError: () => void;
}

/**
 * The organizer's tools for the list, on their own page: reorder (drag, or the arrows for keyboards
 * and screen readers), back to sign-up order, one position per player, and remove. The first
 * `maxPlayers` play; the rest wait on the bench.
 */
export function ManageLineup({ players, maxPlayers, positionsEnabled, onMove, onResetOrder, onSetPosition, onRemove, error, onDismissError }: Props) {
  const t = useT();
  const { active, bench } = splitRoster(players, maxPlayers);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  const row = (player: Player, index: number) => (
    <Box
      component="li" key={player.id} draggable
      onDragStart={() => setDrag({ from: index, over: null })}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag((d) => (d ? { ...d, over: index } : d)); }}
      onDrop={() => { if (drag && drag.over !== null && drag.over !== drag.from) onMove(players[drag.from].id, { to: drag.over }); setDrag(null); }}
      onDragEnd={() => setDrag(null)}
      sx={{
        display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1, minHeight: 52, py: 0.5, listStyle: "none", borderTop: 1, borderColor: "divider",
        opacity: drag?.from === index ? 0.4 : 1, boxShadow: drag && drag.over === index && drag.from !== index ? (th) => `inset 0 2px 0 ${th.palette.primary.main}` : "none",
      }}
    >
      <Box sx={{ display: "flex", flex: "none" }}>
        <IconButton aria-label={t("ngManageMoveUp", { name: player.name })} disabled={index === 0} onClick={() => onMove(player.id, { by: -1 })} sx={{ width: 44, height: 44, ...tappable }}><ArrowUpwardIcon fontSize="small" /></IconButton>
        <IconButton aria-label={t("ngManageMoveDown", { name: player.name })} disabled={index === players.length - 1} onClick={() => onMove(player.id, { by: 1 })} sx={{ width: 44, height: 44, ...tappable }}><ArrowDownwardIcon fontSize="small" /></IconButton>
      </Box>
      {player.userId
        ? <PlayerAvatar userId={player.userId} name={player.name} image={player.image} size={24} clickable={false} />
        : <span title={t("anonymousPlayer")}><AnonymousPlayerIcon /></span>}
      <Typography sx={{ flex: "1 1 8rem", minWidth: 0, fontSize: "1rem", overflowWrap: "anywhere" }}>
        {index < maxPlayers ? `${index + 1}. ` : `${index - maxPlayers + 1}. `}{player.name}
      </Typography>
      {positionsEnabled && (
        <TextField
          select size="small" variant="standard" value={player.position ?? ""}
          onChange={(e) => onSetPosition(player.name, e.target.value || null)}
          sx={{ minWidth: 88 }} slotProps={{ htmlInput: { "aria-label": `${t("positionLabel")}: ${player.name}` } }}
        >
          {POSITIONS.map(([value, key]) => <MenuItem key={value} value={value}>{t(key)}</MenuItem>)}
        </TextField>
      )}
      <Box sx={{ display: "flex", marginLeft: "auto" }}>
        <DragIndicatorIcon
          aria-hidden data-testid="drag-grip" fontSize="small"
          sx={{ alignSelf: "center", mx: 0.5, color: "text.secondary", cursor: "grab", "@media (pointer: coarse)": { display: "none" } }}
        />
        <IconButton aria-label={t("ngManageRemoveAria", { name: player.name })} onClick={() => onRemove(player)} sx={{ width: 44, height: 44, color: "error.main", ...tappable }}><CloseIcon fontSize="small" /></IconButton>
      </Box>
    </Box>
  );

  return (
    <Stack spacing={2}>
      <Typography sx={{ fontSize: "1rem", color: "text.secondary", textWrap: "pretty" }}>{t("ngManageHint", { n: maxPlayers })}</Typography>
      {error && <Alert severity="error" onClose={onDismissError}>{error}</Alert>}
      {players.length === 0 ? (
        <Typography>{t("ngManageEmpty")}</Typography>
      ) : (
        <Box>
          <Typography component="h2" sx={{ fontSize: "1rem", fontWeight: 700 }}>{t("ngManagePlaying", { n: active.length, max: maxPlayers })}</Typography>
          <Box component="ul" sx={{ m: 0, p: 0 }}>{active.map((p, i) => row(p, i))}</Box>
          {bench.length > 0 && (
            <>
              <Typography component="h2" sx={{ mt: 2, fontSize: "1rem", fontWeight: 700 }}>{t("ngBenchHeading", { n: bench.length })}</Typography>
              <Box component="ul" sx={{ m: 0, p: 0 }}>{bench.map((p, i) => row(p, maxPlayers + i))}</Box>
            </>
          )}
        </Box>
      )}
      <Box>
        <Button startIcon={<RestartAltIcon />} onClick={onResetOrder} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}>{t("resetPlayerOrder")}</Button>
      </Box>
    </Stack>
  );
}
