import { Box, Button } from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import PaymentsIcon from "@mui/icons-material/Payments";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import { useT } from "~/lib/useT";
import { summarizePayments } from "~/lib/paymentSummary";
import { buildRankExplainerHref, outcomeFromScore, type RankOutcome } from "~/lib/rankExplainer";
import type { PostGameStatus } from "./postGameStatus";
import { tappable } from "./styles";

/**
 * Where the Ranking tile goes. The recap says "+143 points this season" in one plain line; the tile is
 * where the why lives. When this game moved the viewer's points that is the rank explainer filled in with
 * this game's numbers (the page the "your rank changed" push opens, and the one the Season page links to);
 * otherwise the rankings page.
 */
export function rankingHref(eventId: string, status: PostGameStatus): string {
  const move = status.seasonRank;
  if (!move?.counted || status.viewerTeam === null || status.viewerTeam === undefined) return `/events/${eventId}/rankings`;
  const teamOne = outcomeFromScore(status.scoreOne, status.scoreTwo);
  // `outcomeFromScore` is team one's point of view; the explainer reads the viewer's.
  const outcome: RankOutcome = status.viewerTeam === 0 ? teamOne : teamOne === 1 ? 0 : teamOne === 0 ? 1 : 0.5;
  return buildRankExplainerHref(eventId, { seasonId: move.seasonId, rank: move.after, delta: move.delta, outcome });
}

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
    { key: "ranking", label: t("recapLinkRanking"), icon: <LeaderboardIcon fontSize="small" />, href: rankingHref(eventId, status), sub: t("recapLinkRankingSub") },
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
