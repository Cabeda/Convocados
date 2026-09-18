/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Async server data initializes local state. */
import { useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, IconButton,
  Link, Stack, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { EXPECTED_CLAMP, RANK_POINT_SCALE, TIER_NAMES } from "~/lib/seasonRank";
import type { RankOutcome } from "~/lib/rankExplainer";
import { RankMathDemo } from "./rank/RankMathDemo";
import { PayoutDemo } from "./rank/PayoutDemo";

interface RankApiPlayer {
  name: string;
  display: number;
  tier: number;
  provisional: boolean;
}
interface RankApiPayload {
  players: RankApiPlayer[];
  edges: number[];
  anchor: number;
  youName?: string | null;
}

function readNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOutcome(value: string | null): RankOutcome | null {
  if (value === "1") return 1;
  if (value === "0.5") return 0.5;
  if (value === "0") return 0;
  return null;
}

/**
 * Per-event, in-app explainer for a single Game's Rank movement. Pre-filled
 * from the query string (the banner's "Why?" link) so a shared URL reproduces
 * the exact calculation, and embeds the reusable demo widgets.
 */
export default function RankExplainerPage({ eventId }: { eventId: string }) {
  const t = useT();
  const params = useMemo(
    () => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    [],
  );

  const seasonId = params.get("seasonId");
  const rankParam = readNumber(params.get("rank")) ?? readNumber(params.get("after"));
  const deltaParam = readNumber(params.get("delta"));
  const opponentParam = readNumber(params.get("opponentAvg"));
  const outcomeParam = readOutcome(params.get("outcome"));

  const [viewer, setViewer] = useState<RankApiPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Opened without numbers (e.g. from the Season page): look the viewer up so
  // the widgets still start from their real Rank.
  useEffect(() => {
    if (!seasonId || rankParam !== null) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/events/${eventId}/seasons/${seasonId}/rank`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RankApiPayload | null) => {
        if (!data) return;
        setViewer(data.players.find((p) => p.name === data.youName) ?? null);
      })
      .catch(() => { /* non-fatal: widgets fall back to defaults */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId, seasonId, rankParam]);

  const rank = rankParam ?? viewer?.display ?? null;
  const provisional = rankParam === null && !!viewer?.provisional;
  const backHref = seasonId ? `/events/${eventId}/seasons/${seasonId}` : `/events/${eventId}`;

  const summary = [
    rank !== null ? { label: t("rankExplainerRankAfter"), value: String(rank) } : null,
    deltaParam !== null ? { label: t("rankExplainerDelta"), value: `${deltaParam > 0 ? "+" : ""}${deltaParam} RP` } : null,
    outcomeParam !== null
      ? {
          label: t("rankExplainerOutcome"),
          value: outcomeParam === 1 ? t("rankExplainerOutcomeWin") : outcomeParam === 0 ? t("rankExplainerOutcomeLoss") : t("rankExplainerOutcomeDraw"),
        }
      : null,
    opponentParam !== null ? { label: t("rankExplainerOpponent"), value: String(opponentParam) } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Button variant="outlined" size="small" startIcon={<ArrowBackIcon />} href={backHref}>
                {seasonId ? t("backToSeasons") : t("backToGame")}
              </Button>
            </Box>

            <Box>
              <Typography variant="h4" component="h1" fontWeight={700}>{t("rankExplainerTitle")}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>{t("rankExplainerIntro")}</Typography>
            </Box>

            {loading && <Box sx={{ textAlign: "center" }}><CircularProgress size={24} /></Box>}

            {summary.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    {t("rankExplainerInputsTitle")}
                  </Typography>
                  <Stack divider={<Box sx={{ borderTop: "1px dashed", borderColor: "divider" }} />} spacing={1}>
                    {summary.map((row) => (
                      <Box key={row.label} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                        <Typography variant="body2" color="text.secondary">{row.label}</Typography>
                        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: "ui-monospace, monospace" }}>{row.value}</Typography>
                      </Box>
                    ))}
                  </Stack>
                  {provisional && (
                    <Chip size="small" variant="outlined" label={t("seasonRankProvisional")} sx={{ mt: 1.5, fontWeight: 700 }} />
                  )}
                  {rank !== null && <RankTierNote tier={viewer?.tier ?? null} />}
                </CardContent>
              </Card>
            )}

            <RankMathDemo
              yourRating={rank ?? undefined}
              opponentAvg={opponentParam ?? undefined}
              outcome={outcomeParam ?? undefined}
            />

            <PayoutDemo
              yourRating={rank ?? undefined}
              opponentAvg={opponentParam ?? undefined}
              clamp={EXPECTED_CLAMP}
              scale={RANK_POINT_SCALE}
            />

            <Card variant="outlined">
              <CardContent>
                <Typography variant="body2">{t("rankExplainerShareNote")}</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                  <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", flex: 1, wordBreak: "break-all" }}>
                    {typeof window !== "undefined" ? window.location.href : ""}
                  </Typography>
                  <IconButton size="small" onClick={copyLink} aria-label={t("copyLink")}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
                {copied && <Alert severity="success" sx={{ mt: 1 }}>{t("linkCopied")}</Alert>}
                <Box sx={{ mt: 1.5 }}>
                  <Link href="/docs/rank" target="_blank" rel="noopener noreferrer">{t("rankExplainerDocsLink")}</Link>
                </Box>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}

function RankTierNote({ tier }: { tier: number | null }) {
  const t = useT();
  if (tier === null) return null;
  const name = TIER_NAMES[tier] ?? TIER_NAMES[0];
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
      {t("rankExplainerTierNote", { tier: name })}
    </Typography>
  );
}
