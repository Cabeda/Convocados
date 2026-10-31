import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Container, IconButton, Paper, Stack, Typography,
} from "@mui/material";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { ApiError, apiErrorMessage, apiRequest } from "~/lib/api/client";
import { formatDateInTz } from "~/lib/timezones";
import { NOTIFICATIONS_CHANGED } from "~/lib/notificationEvents";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Feed {
  notifications: NotificationRow[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The in-app feed, on the web (#1560). Rows are the same ones Android shows:
 * `title`/`body` are already localised when the notification was written, and
 * `url` deep-links to the surface that can act on it (a captain nomination
 * opens the season page where Accept lives).
 */
export default function NotificationsPage() {
  const t = useT();
  const locale = detectLocale();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setFeed((await apiRequest("GET /api/me/notifications")) as unknown as Feed);
    } catch (loadError) {
      // A failed load must not render an error object as a feed.
      if (loadError instanceof ApiError && loadError.status === 401) { setNeedsSignIn(true); return; }
      setError(apiErrorMessage(loadError, t("somethingWentWrong")));
    }
  };

  useEffect(() => { void load(); }, []);

  /** Tell the header bell its count is stale — it is a separate component. */
  const announceRead = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

  const markRead = async (ids?: string[]) => {
    setBusy(true);
    try {
      await apiRequest("POST /api/me/notifications", {
        body: ids ? { ids } : {},
      });
      await load();
      announceRead();
    } catch (writeError) {
      setError(apiErrorMessage(writeError, t("somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Following a row leaves the page, so the mark-read POST must outlive the
   * navigation: `keepalive` keeps it in flight and the loader would be wasted.
   */
  const markReadAndLeave = (id: string) => {
    void fetch("/api/me/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
      keepalive: true,
    });
    announceRead();
  };

  // Rows carry no timezone; the feed is written by the server in its own time,
  // so UTC is the honest zone to render it in.
  const when = (iso: string) =>
    formatDateInTz(new Date(iso), locale, "UTC", { dateStyle: "medium", timeStyle: "short" });

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 6 }}>
          {needsSignIn && (
            <Paper elevation={1} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
              <Typography gutterBottom>{t("signInToSeeNotifications")}</Typography>
              <Button variant="contained" href="/auth/signin">{t("signIn")}</Button>
            </Paper>
          )}
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!needsSignIn && !feed && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
          )}
          {feed && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h5" fontWeight={700}>{t("notifications")}</Typography>
                {feed.unreadCount > 0 && (
                  <Button size="small" startIcon={<DoneAllIcon />} disabled={busy} onClick={() => void markRead()}>
                    {t("markAllRead")}
                  </Button>
                )}
              </Stack>

              {feed.notifications.length === 0 && (
                <Paper elevation={1} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                  <NotificationsNoneIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                  <Typography variant="h6" color="text.secondary" gutterBottom>{t("notificationsEmpty")}</Typography>
                  <Typography variant="body2" color="text.secondary">{t("notificationsEmptyDesc")}</Typography>
                </Paper>
              )}

              {feed.notifications.map((row) => {
                const unread = !row.readAt;
                return (
                  <Paper key={row.id} elevation={unread ? 2 : 0} sx={{
                    borderRadius: 3, p: 2,
                    ...(unread ? { borderLeft: 4, borderColor: "primary.main" } : {}),
                  }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography fontWeight={unread ? 700 : 500}>{row.title}</Typography>
                          {unread && <Chip size="small" color="primary" label={t("unread")} />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{row.body}</Typography>
                        <Typography variant="caption" color="text.disabled">{when(row.createdAt)}</Typography>
                      </Box>
                      {row.url && (
                        <Button
                          size="small"
                          href={row.url}
                          onClick={() => { if (unread) markReadAndLeave(row.id); }}
                        >
                          {t("openNotification")}
                        </Button>
                      )}
                      {unread && (
                        <IconButton size="small" aria-label={t("markRead")} disabled={busy} onClick={() => void markRead([row.id])}>
                          <DoneAllIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
