import { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button, Chip, Alert,
  Divider, List, ListItem, ListItemText, CircularProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import { formatMoney, formatShortDate } from "~/lib/money";
import { PaymentConfigDialog } from "./PaymentConfigDialog";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { CostSection } from "./CostSection";

const STATUS_LABEL: Record<string, TranslationKey> = {
  pending: "paymentsStatusPending",
  sent: "paymentsStatusSent",
  paid: "paymentsStatusPaid",
};

interface SettlementRow {
  eventPlayerId: string;
  name: string;
  amount: number;
  status: string;
  isPayer: boolean;
}

interface SettlementGame {
  gameId: string;
  dateTime: string;
  mode: "tracked" | "untracked";
  payerName: string | null;
  payerIsPlayer: boolean;
  total: number;
  paidCount: number;
  debtorCount: number;
  debtorNames: string[];
  rows: SettlementRow[];
}

interface SettlementPerson {
  name: string;
  isPlayer: boolean;
  isPayer: boolean;
  owedToAmount: number;
  owedAmount: number;
  lines: Array<{ gameId: string; dateTime: string; amount: number; status: string; role: "debtor" | "payer" }>;
}

interface SettlementSummary {
  games: SettlementGame[];
  people: SettlementPerson[];
  currentGameId: string | null;
  viewerRole: "owner" | "admin" | "player";
  viewerEventPlayerId: string | null;
  activePlayerCount: number;
  maxPlayers: number;
  totals: { unsettledGames: number; totalOwed: number; totalOwedTo: number };
}

export default function PaymentsPage({ eventId }: { eventId: string }) {
  const t = useT();
  const [data, setData] = useState<SettlementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configGame, setConfigGame] = useState<SettlementGame | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/settlement`);
      if (res.status === 401) {
        setError("signin");
        setData(null);
      } else if (res.status === 403) {
        setError("forbidden");
        setData(null);
      } else if (!res.ok) {
        setError("failed");
        setData(null);
      } else {
        setData(await res.json());
        setError(null);
      }
    } catch {
      setError("failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 4, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error === "signin") {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="info">{t("paymentsSignInRequired")}</Alert>
      </Container>
    );
  }

  if (error === "forbidden") {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="md" sx={{ py: 4 }}>
            <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => { window.location.href = `/events/${eventId}`; }} sx={{ mb: 1 }}>
              {t("backToGame")}
            </Button>
            <Alert severity="info">{t("paymentsPlayersOnly")}</Alert>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  const isManager = data?.viewerRole === "owner" || data?.viewerRole === "admin";

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => { window.location.href = `/events/${eventId}`; }} sx={{ mb: 1 }}>
            {t("backToGame")}
          </Button>
          <Typography variant="h5" gutterBottom>{t("paymentsPageTitle")}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>{t("paymentsIntro")}</Typography>

      {error === "failed" && (
        <Alert severity="error" sx={{ my: 2 }}>{t("paymentsFailed")}</Alert>
      )}

      {data && data.games.length === 0 && (
        <Alert severity="success" sx={{ my: 2 }}>{t("paymentsNoUnsettled")}</Alert>
      )}

      {/* ── Cost & payment methods (manager of price/methods) ──────── */}
      <CostSection eventId={eventId} isManager={data?.viewerRole === "owner" || data?.viewerRole === "admin"} maxPlayers={data?.maxPlayers ?? 0} />

      {/* ── People rollup ─────────────────────────────────────────── */}
      {data && data.people.length > 0 && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6">{t("paymentsToReceive")}</Typography>
          <List dense>
            {data.people.filter((p) => p.isPayer).map((p) => (
              <ListItem key={`r-${p.name}`} divider>
                <ListItemText
                  primary={t("paymentsIsOwed", { name: p.name, amount: formatMoney(p.owedToAmount, "EUR") })}
                  secondary={p.lines.length > 0 ? `${t("paymentsUnsettledGames")} · ${p.lines.length}` : ""}
                />
              </ListItem>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <Typography variant="h6">{t("paymentsToPay")}</Typography>
          <List dense>
            {data.people.filter((p) => !p.isPayer).map((p) => (
              <ListItem key={`d-${p.name}`} divider>
                <ListItemText
                  primary={t("paymentsOwes", { name: p.name, amount: formatMoney(p.owedAmount, "EUR") })}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* ── Unsettled games ───────────────────────────────────────── */}
      {data && data.games.length > 0 && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6">{t("paymentsUnsettledGames")}</Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {data.games.map((g) => (
              <Box key={g.gameId}>
                <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                  <Typography variant="subtitle1">
                    {t("paymentsGameDate", { date: formatShortDate(g.dateTime) })}
                  </Typography>
                  <Box>
                    {isManager && (
                      <Button size="small" onClick={() => setConfigGame(g)}>
                        {t("paymentsConfigTitle")}
                      </Button>
                    )}
                    {isManager && g.debtorCount > 0 && (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy}
                        onClick={() => runAction(`/api/events/${eventId}/payments/settlement/bulk`, { gameId: g.gameId })}
                      >
                        {t("paymentsSettleAll")}
                      </Button>
                    )}
                  </Box>
                </Box>
                <Box ml={1}>
                  <Typography variant="body2" color="text.secondary">
                    {g.payerName
                      ? t("paymentsIsOwed", { name: g.payerName, amount: formatMoney(g.total, "EUR") })
                      : t("paymentsUnassignedPayer")}
                    {g.payerIsPlayer ? ` · ${t("paymentsPayer")}` : ""}
                  </Typography>
                  {g.mode === "untracked" && (
                    <Typography variant="body2" color="text.secondary">{t("paymentsUntrackedNote")}</Typography>
                  )}
                </Box>
                {isManager && (
                  <List dense sx={{ ml: 2 }}>
                    {g.rows.filter((r) => r.status === "pending" || r.status === "sent").map((r) => (
                      <ListItem key={r.eventPlayerId} secondaryAction={
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => runAction(`/api/events/${eventId}/payments/settlement`, { gameId: g.gameId, eventPlayerId: r.eventPlayerId })}
                        >
                          {t("paymentsMarkPaid")}
                        </Button>
                      }>
                        <ListItemText
                          primary={r.name}
                          secondary={t(STATUS_LABEL[r.status] ?? "paymentsStatusPending")}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {/* ── Self-report (player) ──────────────────────────────────── */}
      {data && !isManager && data.viewerEventPlayerId && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6">{t("paymentsToPay")}</Typography>
          <List dense>
            {data.people.filter((p) => p.isPlayer && p.owedAmount > 0).map((p) => (
              <ListItem key={p.name} divider>
                <ListItemText primary={t("paymentsOwes", { name: p.name, amount: formatMoney(p.owedAmount, "EUR") })} />
              </ListItem>
            ))}
          </List>
          {data.games.flatMap((g) => g.rows.filter((r) => r.eventPlayerId === data.viewerEventPlayerId && (r.status === "pending" || r.status === "sent"))).map((r) => (
            <Stack key={`${r.eventPlayerId}-${r.name}`} direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <Chip
                label={t(STATUS_LABEL[r.status] ?? "paymentsStatusPending")}
                color={r.status === "sent" ? "warning" : "default"}
              />
              <Button
                size="small"
                variant="outlined"
                disabled={busy || r.status === "sent"}
                onClick={async () => {
                  const game = data.games.find((g2) => g2.rows.some((x) => x.eventPlayerId === r.eventPlayerId));
                  if (!game) return;
                  setBusy(true);
                  try {
                    const res = await fetch(`/api/events/${eventId}/payments/settlement/self-report`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ gameId: game.gameId, eventPlayerId: r.eventPlayerId }),
                    });
                    if (!res.ok) throw new Error();
                    await load();
                  } catch {
                    setError("failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("paymentsReportSent")}
              </Button>
            </Stack>
          ))}
        </Paper>
      )}

      <PaymentConfigDialog
        open={!!configGame}
        eventId={eventId}
        game={configGame}
        onClose={() => setConfigGame(null)}
        onSaved={async () => {
          setConfigGame(null);
          await load();
        }}
      />
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
