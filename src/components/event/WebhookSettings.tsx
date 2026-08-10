/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import { useState, useEffect, useCallback } from "react";
import {
  Box, Button, Stack, Typography, TextField, Checkbox, FormControlLabel,
  FormGroup, Paper, List, ListItem, ListItemText, Chip, CircularProgress,
  IconButton, Tooltip, Alert, Divider,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";

const EVENT_TYPE_LABELS: Record<string, TranslationKey> = {
  player_joined: "webhookEventType_player_joined",
  player_left: "webhookEventType_player_left",
  game_full: "webhookEventType_game_full",
  game_reset: "webhookEventType_game_reset",
};

const DELIVERY_STATUS_LABELS: Record<string, TranslationKey> = {
  success: "webhookDeliveryStatus_success",
  failed: "webhookDeliveryStatus_failed",
  pending: "webhookDeliveryStatus_pending",
};

const EVENT_TYPES = ["player_joined", "player_left", "game_full", "game_reset"] as const;

interface Webhook {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

interface Delivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  error: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface Props {
  eventId: string;
}

export function WebhookSettings({ eventId }: Props) {
  const t = useT();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([...EVENT_TYPES]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, Delivery>>({});

  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/webhooks`);
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks ?? []);
      } else {
        setError(t("webhookAddError"));
      }
    } catch {
      setError(t("webhookAddError"));
    }
    setLoading(false);
  }, [eventId, t]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleAdd = async () => {
    setError(null);
    if (!url.trim()) {
      setError(t("webhookUrlRequired"));
      return;
    }
    try {
      new URL(url);
    } catch {
      setError(t("webhookInvalidUrl"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events, secret: secret.trim() || null }),
      });
      if (res.ok) {
        setUrl(""); setSecret("");
        setError(null);
        await fetchWebhooks();
      } else {
        const data = await res.json().catch(() => ({ error: t("webhookAddError") }));
        setError(data.error ?? t("webhookAddError"));
      }
    } catch {
      setError(t("webhookAddError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("webhookDeleteConfirm"))) return;
    try {
      await fetch(`/api/events/${eventId}/webhooks/${id}`, { method: "DELETE" });
    } catch {
      setError(t("webhookAddError"));
    }
    await fetchWebhooks();
  };

  const handleTest = async (id: string) => {
    setTestResult((r) => ({ ...r, [id]: { id: "", eventType: "test", status: "pending", attempts: 0, error: null, deliveredAt: null, createdAt: "" } }));
    try {
      const res = await fetch(`/api/events/${eventId}/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.delivery) setTestResult((r) => ({ ...r, [id]: data.delivery }));
    } catch {
      setTestResult((r) => ({ ...r, [id]: { ...r[id], status: "failed", error: "Network error" } }));
    }
  };

  const handleToggleEvent = (ev: string) => {
    setEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));
  };

  const statusChip = (status: string) => {
    const map: Record<string, "success" | "error" | "warning" | "default"> = {
      success: "success", failed: "error", pending: "warning",
    };
    const label = DELIVERY_STATUS_LABELS[status] ?? "webhookDeliveryStatus_pending";
    return <Chip size="small" label={t(label)} color={map[status] ?? "default"} />;
  };

  if (loading) return <CircularProgress size={24} />;

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        {t("webhookHelp")}
      </Typography>

      {/* Add form */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
        <Stack spacing={1.5}>
          <TextField
            size="small"
            fullWidth
            label={t("webhookUrl")}
            placeholder="https://example.com/receive"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <TextField
            size="small"
            fullWidth
            type="password"
            autoComplete="off"
            label={t("webhookSecret")}
            placeholder={t("webhookSecretPlaceholder")}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <FormGroup row>
            {EVENT_TYPES.map((ev) => (
              <FormControlLabel
                key={ev}
                control={<Checkbox size="small" checked={events.includes(ev)} onChange={() => handleToggleEvent(ev)} />}
                label={<Typography variant="body2">{t(`webhookEventType_${ev}`)}</Typography>}
              />
            ))}
          </FormGroup>
          {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={saving}
            sx={{ alignSelf: "flex-start" }}
          >
            {t("webhookAdd")}
          </Button>
        </Stack>
      </Paper>

      <Divider />

      {/* Existing webhooks */}
      {webhooks.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
          {t("webhookNone")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {webhooks.map((wh) => (
            <ListItem key={wh.id} disableGutters sx={{ alignItems: "flex-start" }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{wh.url}</Typography>
                    {testResult[wh.id] ? statusChip(testResult[wh.id].status) : null}
                  </Stack>
                }
                secondary={
                  <Stack spacing={0.5}>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {wh.events.length === 0
                        ? <Chip size="small" label={t("webhookAllEvents")} />
                        : wh.events.map((e) => <Chip key={e} size="small" label={t(EVENT_TYPE_LABELS[e] ?? "webhookAllEvents")} />)}
                    </Box>
                    {testResult[wh.id] && testResult[wh.id].status !== "pending" && (
                      <Typography variant="caption" color="text.secondary">
                        {testResult[wh.id].error
                          ? t("webhookTestFailed", { error: testResult[wh.id].error ?? "" })
                          : t("webhookTestOk", { at: (testResult[wh.id].deliveredAt ?? testResult[wh.id].createdAt).toString().slice(0, 19).replace("T", " ") })}
                      </Typography>
                    )}
                  </Stack>
                }
              />
              <Tooltip title={t("webhookTest")}>
                <IconButton size="small" aria-label={t("webhookTest")} onClick={() => handleTest(wh.id)}>
                  <SendIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("webhookDelete")}>
                <IconButton size="small" aria-label={t("webhookDelete")} onClick={() => handleDelete(wh.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      )}
    </Stack>
  );
}
