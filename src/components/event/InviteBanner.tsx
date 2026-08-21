import { useState, useEffect } from "react";
import {
  Paper, Typography, Button, Alert, Box, Stack, Chip, CircularProgress,
} from "@mui/material";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useT } from "~/lib/useT";

interface InviteData {
  valid: boolean;
  status: string;
  token: string;
  isInvitee: boolean;
  authenticated: boolean;
  inviteeName: string;
  invitedByName: string;
  gameId: string;
  game: {
    id: string;
    title: string;
    location: string;
    dateTime: string;
    maxPlayers: number;
  };
}

export function InviteBanner({ token, eventId, onAccepted }: { token: string; eventId: string; onAccepted?: () => void }) {
  const t = useT();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/invite/${token}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(t("somethingWentWrong")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, t]);

  const respond = async (action: "accept" | "decline") => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({ error: t("somethingWentWrong") }));
      if (!res.ok) {
        setError(json.error ?? t("somethingWentWrong"));
        setBusy(false);
        return;
      }
      setData({ ...data, status: action === "accept" ? "accepted" : "declined" });
      if (action === "accept" && onAccepted) onAccepted();
      // Clean the token from URL after action so refresh doesn't re-trigger banner
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("inviteToken");
        window.history.replaceState({}, "", url.toString());
      } catch {}
    } catch {
      setError(t("somethingWentWrong"));
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  if (!data?.valid || data.status === "not_found") {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2 }}>
        <Alert severity="error">{t("inviteNotFound")}</Alert>
      </Paper>
    );
  }

  // If invite is for a different event, show info but don't offer accept/decline for this event
  if (data.game.id !== eventId) {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2 }}>
        <Alert severity="warning">
          {t("inviteNotForThisEvent" as any) || `This invite is for another game: ${data.game.title}`}
        </Alert>
        <Button variant="outlined" href={`/events/${data.game.id}`} sx={{ mt: 1 }}>
          {t("inviteViewGame")}
        </Button>
      </Paper>
    );
  }

  if (data.status === "expired") {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2, textAlign: "center" }}>
        <Alert severity="warning" sx={{ mb: 1 }}>{t("inviteExpired")}</Alert>
        <Button variant="outlined" href={`/events/${eventId}`}>{t("inviteViewGame")}</Button>
      </Paper>
    );
  }

  if (data.status === "accepted") {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2, textAlign: "center" }}>
        <Alert severity="success" icon={<CheckCircleIcon />}>{t("inviteAccepted")}</Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("inviteAcceptedDesc" as any) || "You're in! Check the roster below."}
        </Typography>
      </Paper>
    );
  }

  if (data.status === "declined" || data.status === "cancelled") {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2, textAlign: "center" }}>
        <Alert severity="info">{data.status === "declined" ? t("inviteDeclined") : t("inviteCancelled")}</Alert>
      </Paper>
    );
  }

  // pending — check auth
  if (!data.authenticated) {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 3, mb: 2, textAlign: "center" }}>
        <Typography variant="h6" fontWeight={700}>{data.game.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("inviteInvitedBy").replace("{name}", data.invitedByName)}
        </Typography>
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1, flexWrap: "wrap" }}>
          {data.game.location && <Chip size="small" label={data.game.location} variant="outlined" />}
          <Chip size="small" label={new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.game.dateTime))} variant="outlined" />
        </Stack>
        <Alert severity="info" sx={{ mt: 2, textAlign: "left" }}>{t("inviteSignInCta")}</Alert>
        <Button
          variant="contained"
          startIcon={<HowToRegIcon />}
          href={`/auth/signin?callbackURL=${encodeURIComponent(`/events/${eventId}?inviteToken=${token}`)}`}
          sx={{ mt: 2 }}
        >
          {t("inviteSignIn")}
        </Button>
      </Paper>
    );
  }

  if (!data.isInvitee) {
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: 2, mb: 2 }}>
        <Alert severity="warning">{t("inviteNotForYou")}</Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("inviteNotForYouDesc" as any) || `This invite is for ${data.inviteeName}. You can still view the event below.`}
        </Typography>
      </Paper>
    );
  }

  // Pending and isInvitee authenticated — show Accept/Decline banner
  return (
    <Paper elevation={3} sx={{ borderRadius: 3, p: 3, mb: 2, border: 2, borderColor: "primary.main" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Chip label={t("invitePendingLabel" as any) || "Invited"} color="primary" size="small" />
        <Typography variant="body2" color="text.secondary">
          {t("inviteInvitedBy").replace("{name}", data.invitedByName)}
        </Typography>
      </Box>
      <Typography variant="h6" fontWeight={700}>{data.game.title}</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
        {data.game.location && <Chip size="small" label={data.game.location} variant="outlined" />}
        <Chip size="small" label={new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.game.dateTime))} variant="outlined" />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t("inviteBannerDesc" as any) || `You've been invited to join this game. Accept to join the roster, or decline if you can't make it.`}
      </Typography>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2 }}>
        <Button variant="contained" color="primary" size="large" disabled={busy} onClick={() => respond("accept")} startIcon={<CheckCircleIcon />}>
          {t("inviteAccept")}
        </Button>
        <Button variant="outlined" color="inherit" disabled={busy} onClick={() => respond("decline")}>
          {t("inviteDeclineBtn")}
        </Button>
      </Stack>
    </Paper>
  );
}
