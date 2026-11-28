import { useId, useState, type ReactNode } from "react";
import { Box, Button, Chip, Link, Typography } from "@mui/material";
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
  /** Extra control at the end of a row (Remove, once the viewer may). */
  rowAction?: (player: Player) => ReactNode;
  /** Opens the list from outside (a pressed slot, a deep link). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function Row({ player, me, number, positionsEnabled, action }: { player: Player; me: boolean; number?: number; positionsEnabled: boolean; action: ReactNode }) {
  const t = useT();
  const label = number ? `${number}. ${player.name}` : player.name;
  return (
    <Box component="li" sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, breakInside: "avoid", listStyle: "none" }}>
      {player.userId
        ? <PlayerAvatar userId={player.userId} name={player.name} image={player.image} size={22} clickable={false} />
        : <span title={t("anonymousPlayer")}><AnonymousPlayerIcon /></span>}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.75 }}>
        {player.userId ? (
          <Link href={`/users/${player.userId}`} underline="hover" color="inherit" sx={{ fontSize: "1rem", lineHeight: 1.35, overflowWrap: "anywhere", borderRadius: 1, ...focusRing }}>{label}</Link>
        ) : (
          <Typography component="span" sx={{ fontSize: "1rem", lineHeight: 1.35, overflowWrap: "anywhere" }}>{label}</Typography>
        )}
        {me && <Typography component="span" sx={{ fontSize: "0.875rem", color: "text.secondary" }}>({t("ngYouTag")})</Typography>}
        {positionsEnabled && player.position && POSITION_KEYS[player.position] && (
          <Chip size="small" variant="outlined" label={t(POSITION_KEYS[player.position])} />
        )}
      </Box>
      {action}
    </Box>
  );
}

/**
 * "Who's in": the names behind the initials, for anyone who recognises people by name
 * (and for screen readers). Two columns; the bench follows, numbered.
 */
export function WhosIn({ playing, bench, viewerId, positionsEnabled, rowAction, open: openProp, onOpenChange }: Props) {
  const t = useT();
  const id = useId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  if (playing.length === 0 && bench.length === 0) return null;

  return (
    <Box>
      <Button
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        sx={{ minHeight: 44, ml: -1.5, px: 1.5, textTransform: "none", fontSize: "1rem", fontWeight: 700, color: "text.secondary", borderRadius: 999, ...tappable }}
      >
        {t("ngWhosIn")}
      </Button>
      {open && (
        <Box id={id} data-testid="whos-in">
          <Box component="ul" sx={{ m: 0, p: 0, columnCount: { xs: 1, sm: 2 }, columnGap: 3 }}>
            {playing.map((p) => (
              <Row key={p.id} player={p} me={!!viewerId && p.userId === viewerId} positionsEnabled={positionsEnabled} action={rowAction?.(p)} />
            ))}
          </Box>
          {bench.length > 0 && (
            <>
              <Typography component="h3" sx={{ mt: 1.5, fontSize: "0.875rem", fontWeight: 600, color: "text.secondary" }}>{t("ngBenchHeading", { n: bench.length })}</Typography>
              <Box component="ul" sx={{ m: 0, p: 0, columnCount: { xs: 1, sm: 2 }, columnGap: 3 }}>
                {bench.map((p, i) => (
                  <Row key={p.id} player={p} number={i + 1} me={!!viewerId && p.userId === viewerId} positionsEnabled={positionsEnabled} action={rowAction?.(p)} />
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
