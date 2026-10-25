/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import { useState, useEffect, useCallback } from "react";
import {
  Box, Button, Stack, Typography, TextField, Checkbox, FormControlLabel,
  FormGroup, Paper, List, ListItem, ListItemText, Chip, CircularProgress,
  IconButton, Tooltip, Alert, Divider, Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import { WEBHOOK_EVENT_TYPES } from "~/lib/webhookEvents";
import { ApiError, apiRequest } from "~/lib/api/client";

// ponytail: an event name we don't know falls through as-is rather than
// silently reading as "All events".
function eventTypeLabel(ev: string, t: (k: TranslationKey) => string): string {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(ev)
    ? t(`webhookEventType_${ev}` as TranslationKey)
    : ev;
}

const DELIVERY_STATUS_LABELS: Record<string, TranslationKey> = {
  success: "webhookDeliveryStatus_success",
  failed: "webhookDeliveryStatus_failed",
  pending: "webhookDeliveryStatus_pending",
};

interface Webhook {
  id: string;
  url: string;
  events: string[];
  disabled: boolean;
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
  disabled?: boolean;
  canEdit?: boolean;
  readOnly?: boolean;
  editable?: boolean;
  enabled?: boolean;
}

export function WebhookSettings({ eventId, disabled, canEdit, readOnly, editable, enabled }: Props) {
  const isDisabled =
    disabled === true ||
    canEdit === false ||
    readOnly === true ||
    editable === false ||
    enabled === false;
  const t = useT();
  const webhookDisabled = isDisabled;
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENT_TYPES]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, Delivery>>({});
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = (await apiRequest("GET /api/events/{id}/webhooks", {
        params: { id: eventId },
      })) as { webhooks?: Webhook[] };
      setWebhooks(data.webhooks ?? []);
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
      await apiRequest("POST /api/events/{id}/webhooks", {
        params: { id: eventId },
        body: { url: url.trim(), events, secret: secret.trim() || null },
      });
      setUrl(""); setSecret("");
      setError(null);
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("webhookAddError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("webhookDeleteConfirm"))) return;
    try {
      await apiRequest("DELETE /api/events/{id}/webhooks/{webhookId}", {
        params: { id: eventId, webhookId: id },
      });
    } catch (err) {
      // A rejected response was silent before; only a failed request reported.
      if (!(err instanceof ApiError)) setError(t("webhookAddError"));
    }
    await fetchWebhooks();
  };

  const handleTest = async (id: string) => {
    setTestResult((r) => ({ ...r, [id]: { id: "", eventType: "test", status: "pending", attempts: 0, error: null, deliveredAt: null, createdAt: "" } }));
    try {
      const data = (await apiRequest("POST /api/events/{id}/webhooks/{webhookId}/test", {
        params: { id: eventId, webhookId: id },
      })) as { delivery?: Delivery };
      if (data.delivery) setTestResult((r) => ({ ...r, [id]: data.delivery! }));
    } catch (err) {
      // A rejected response carried no delivery before either; only a failed request did.
      if (err instanceof ApiError) return;
      setTestResult((r) => ({ ...r, [id]: { ...r[id], status: "failed", error: "Network error" } }));
    }
  };

  const handleToggleEvent = (ev: string) => {
    setEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));
  };

  const handleOpenEdit = (wh: Webhook) => {
    setEditing(wh);
    setEditEvents([...wh.events]);
    setEditError(null);
  };

  const handleToggleEditEvent = (ev: string) => {
    setEditEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setEditError(null);
    try {
      await apiRequest("PATCH /api/events/{id}/webhooks/{webhookId}", {
        params: { id: eventId, webhookId: editing.id },
        body: { events: editEvents },
      });
      setEditing(null);
      await fetchWebhooks();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t("webhookEditError"));
    }
  };

  const handleReEnable = async (id: string) => {
    try {
      await apiRequest("PATCH /api/events/{id}/webhooks/{webhookId}", {
        params: { id: eventId, webhookId: id },
        body: { disabled: false },
      });
      await fetchWebhooks();
    } catch (err) {
      // A rejected response was silent before; only a failed request reported.
      if (!(err instanceof ApiError)) setError(t("webhookAddError"));
    }
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
            disabled={webhookDisabled}
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
            disabled={webhookDisabled}
          />
          <FormGroup row>
            {WEBHOOK_EVENT_TYPES.map((ev) => (
              <FormControlLabel
                key={ev}
                control={<Checkbox size="small" checked={events.includes(ev)} onChange={() => handleToggleEvent(ev)} disabled={webhookDisabled} />}
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
            disabled={saving || webhookDisabled}
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
                      {wh.disabled && <Chip size="small" label={t("webhookDisabled")} color="error" />}
                      {wh.events.length === 0
                        ? <Chip size="small" label={t("webhookAllEvents")} />
                        : wh.events.map((e) => <Chip key={e} size="small" label={eventTypeLabel(e, t)} />)}
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
              {wh.disabled && (
                <Tooltip title={t("webhookReEnable")}>
                  <IconButton size="small" aria-label={t("webhookReEnable")} onClick={() => handleReEnable(wh.id)}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t("webhookEdit")}>
                <IconButton size="small" aria-label={t("webhookEdit")} onClick={() => handleOpenEdit(wh)} disabled={webhookDisabled}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("webhookTest")}>
                <IconButton size="small" aria-label={t("webhookTest")} onClick={() => handleTest(wh.id)} disabled={webhookDisabled}>
                  <SendIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("webhookDelete")}>
                <IconButton size="small" aria-label={t("webhookDelete")} onClick={() => handleDelete(wh.id)} disabled={webhookDisabled}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItem>
          ))}
        </List>
      )}

      {/* Edit events dialog */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("webhookEditEvents")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ wordBreak: "break-all", mb: 1 }}>{editing?.url}</Typography>
          <FormGroup row>
            {WEBHOOK_EVENT_TYPES.map((ev) => (
              <FormControlLabel
                key={ev}
                control={<Checkbox size="small" checked={editEvents.includes(ev)} onChange={() => handleToggleEditEvent(ev)} disabled={webhookDisabled} />}
                label={<Typography variant="body2">{t(`webhookEventType_${ev}`)}</Typography>}
              />
            ))}
          </FormGroup>
          {editError && <Alert severity="error" sx={{ mt: 1, py: 0 }}>{editError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setEditing(null)} disabled={webhookDisabled}>{t("cancel")}</Button>
          <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={webhookDisabled}>{t("webhookSave")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
