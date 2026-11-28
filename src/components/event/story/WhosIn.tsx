import { useId, useState, type ReactNode } from "react";
import { Box, Button, Chip, IconButton, Link, Typography } from "@mui/material";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import type { Player } from "../types";
import { AnonymousPlayerIcon, PlayerAvatar } from "../PlayerIdentity";
import { focusRing, tappable } from "./styles";

const POSITION_KEYS: Record<string, TranslationKey> = { GK: "positionGk", DEF: "positionDef", MID: "positionMid", FWD: "positionFwd" };

interface Props {
  playing: readonly Player[];
  bench: readonly Player[];
  viewerId: string | null;
  positionsEnabled: boolean;
  /** Who the viewer may open options for (remove). */
  canSelect?: (player: Player) => boolean;
  selectedId?: string | null;
  onSelect?: (player: Player) => void;
  /** What shows under the selected row (the options). */
  options?: (player: Player) => ReactNode;
  /** Opens the list from outside (a pressed slot, a deep link). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Open until the viewer chooses otherwise: set when two people's letters had to be told apart. */
  autoOpen?: boolean;
  /** Something small on the same line as the toggle, at the far end (the organizer's "Manage lineup"). */
  trailing?: ReactNode;
}

interface RowProps {
  player: Player; me: boolean; number?: number; positionsEnabled: boolean;
  selectable: boolean; selected: boolean; onSelect?: () => void; options?: ReactNode;
}

function Row({ player, me, number, positionsEnabled, selectable, selected, onSelect, options }: RowProps) {
  const t = useT();
  const label = number ? `${number}. ${player.name}` : player.name;
  return (
    <Box component="li" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, minHeight: 44, breakInside: "avoid", listStyle: "none" }}>
      {player.userId
        ? <PlayerAvatar userId={player.userId} name={player.name} image={player.image} size={22} clickable={false} />
        : <span title={t("anonymousPlayer")}><AnonymousPlayerIcon /></span>}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.75 }}>
        {player.userId ? (
          <Link href={`/users/${player.userId}`} underline="hover" color="inherit" sx={{ fontSize: "1rem", lineHeight: 1.35, overflowWrap: "anywhere", borderRadius: 1, fontWeight: me ? 700 : 400, ...focusRing }}>{label}</Link>
        ) : (
          <Typography component="span" sx={{ fontSize: "1rem", lineHeight: 1.35, overflowWrap: "anywhere", fontWeight: me ? 700 : 400 }}>{label}</Typography>
        )}
        {positionsEnabled && player.position && POSITION_KEYS[player.position] && (
          <Chip size="small" variant="outlined" label={t(POSITION_KEYS[player.position])} />
        )}
      </Box>
      {selectable && (
        <IconButton
          aria-label={t("ngOptionsFor", { name: player.name })} aria-expanded={selected} data-trigger={`row:${player.id}`} onClick={onSelect}
          sx={{ width: 44, height: 44, color: "text.secondary", ...tappable }}
        >
          <MoreHorizIcon />
        </IconButton>
      )}
      {selected && options && <Box sx={{ flexBasis: "100%" }}>{options}</Box>}
    </Box>
  );
}

/**
 * "Who's in": the names behind the initials, for anyone who recognises people by name
 * (and for screen readers). Two columns; the bench follows, numbered.
 */
export function WhosIn({ playing, bench, viewerId, positionsEnabled, canSelect, selectedId, onSelect, options, open: openProp, onOpenChange, autoOpen, trailing }: Props) {
  const t = useT();
  const id = useId();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = openProp ?? chosen ?? (!!autoOpen || !!selectedId);
  const setOpen = (v: boolean) => { setChosen(v); onOpenChange?.(v); };
  if (playing.length === 0 && bench.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 1 }}>
        <Button
          aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
          endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ minHeight: 44, ml: -1.5, px: 1.5, textTransform: "none", fontSize: "1rem", fontWeight: 700, color: "text.secondary", borderRadius: 999, ...tappable }}
        >
          {t("ngWhosIn")}
        </Button>
        {trailing}
      </Box>
      {open && (
        <Box id={id} data-testid="whos-in">
          <Box component="ul" sx={{ m: 0, p: 0, columnCount: { xs: 1, sm: 2 }, columnGap: 3 }}>
            {playing.map((p) => (
              <Row key={p.id} player={p} me={!!viewerId && p.userId === viewerId} positionsEnabled={positionsEnabled} selectable={!!canSelect?.(p)} selected={selectedId === p.id} onSelect={() => onSelect?.(p)} options={options?.(p)} />
            ))}
          </Box>
          {bench.length > 0 && (
            <>
              <Typography component="h3" sx={{ mt: 1.5, fontSize: "0.875rem", fontWeight: 600, color: "text.secondary" }}>{t("ngBenchHeading", { n: bench.length })}</Typography>
              <Box component="ul" sx={{ m: 0, p: 0, columnCount: { xs: 1, sm: 2 }, columnGap: 3 }}>
                {bench.map((p, i) => (
                  <Row key={p.id} player={p} number={i + 1} me={!!viewerId && p.userId === viewerId} positionsEnabled={positionsEnabled} selectable={!!canSelect?.(p)} selected={selectedId === p.id} onSelect={() => onSelect?.(p)} options={options?.(p)} />
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
