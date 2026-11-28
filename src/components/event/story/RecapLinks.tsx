import { Box, Button } from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import PaymentsIcon from "@mui/icons-material/Payments";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import { useT } from "~/lib/useT";
import { summarizePayments } from "~/lib/paymentSummary";
import type { PostGameStatus } from "./postGameStatus";
import { tappable } from "./styles";

/** Where the rest of the last game lives: its details, its money, the ranking. Every tile says what it holds. */
export function RecapLinks({ eventId, status, showPayments }: { eventId: string; status: PostGameStatus; showPayments: boolean }) {
  const t = useT();
  const paid = summarizePayments(status.gamePayments ?? []);
  const played = status.lastGamePlayerCount;
  const tiles = [
    {
      key: "game", label: t("recapLinkGame"), icon: <GroupsIcon fontSize="small" />, href: `/events/${eventId}/history`,
      sub: played ? t("recapLinkGameSub", { n: played }) : t("recapLinkGameSubNone"),
    },
    ...(showPayments ? [{
      key: "payments", label: t("recapLinkPayments"), icon: <PaymentsIcon fontSize="small" />, href: `/events/${eventId}/payments`,
      sub: status.gamePayments?.length ? t("recapLinkPaymentsSub", { paid: paid.paidCount, total: paid.totalCount }) : "\u00a0",
    }] : []),
    { key: "ranking", label: t("recapLinkRanking"), icon: <LeaderboardIcon fontSize="small" />, href: `/events/${eventId}/rankings`, sub: t("recapLinkRankingSub") },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`, gap: "1px", bgcolor: "divider", borderTop: 1, borderColor: "divider" }}>
      {tiles.map((l) => (
        <Button
          key={l.key} component="a" href={l.href}
          sx={{
            minWidth: 0, minHeight: 84, flexDirection: "column", justifyContent: "flex-start", alignItems: "center", gap: 0.25, px: 0.75, pt: 1.25, pb: 1, borderRadius: 0,
            textTransform: "none", color: "text.primary", bgcolor: "background.paper", hyphens: "manual", ...tappable,
          }}
        >
          <Box aria-hidden sx={{ display: "flex", height: 20, color: "text.secondary" }}>{l.icon}</Box>
          <Box sx={{ fontSize: "0.9375rem", fontWeight: 700, lineHeight: 1.25, textAlign: "center", overflowWrap: "break-word", maxWidth: "100%" }}>{l.label}</Box>
          <Box sx={{ fontSize: "0.8125rem", color: "text.secondary", lineHeight: 1.3, textAlign: "center", maxWidth: "100%" }}>{l.sub}</Box>
        </Button>
      ))}
    </Box>
  );
}
