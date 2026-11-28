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
    <Box sx={{ display: "flex", flexWrap: "wrap", borderTop: 1, borderColor: "divider" }}>
      {tiles.map((l, i) => (
        <Button
          key={l.key} component="a" href={l.href}
          sx={{
            flex: "1 1 6rem", minWidth: 0, minHeight: 72, flexDirection: "column", justifyContent: "center", gap: 0.25, px: 1, borderRadius: 0,
            textTransform: "none", color: "text.primary", borderLeft: i ? 1 : 0, borderColor: "divider", hyphens: "manual", ...tappable,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.9375rem", fontWeight: 700, lineHeight: 1.25, textAlign: "center" }}>{l.icon}{l.label}</Box>
          <Box sx={{ fontSize: "0.8125rem", color: "text.secondary", lineHeight: 1.3, textAlign: "center" }}>{l.sub}</Box>
        </Button>
      ))}
    </Box>
  );
}
