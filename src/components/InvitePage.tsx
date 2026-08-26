import { useState, useEffect } from "react";
import {
  Paper, Typography, Button, CircularProgress, Alert, Box, Stack, Chip,
} from "@mui/material";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import { useT } from "~/lib/useT";

interface InviteData {
  valid: boolean;
  status: string;
  token: string;
  isInvitee: boolean;
  claimable: boolean;
  claimPlayerId: string | null;
  viewerName: string | null;
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

const acceptedMarkerKey = (token: string) => `invite-accepted:${token}`;

export function InvitePage({ token }: { token: string }) {
  const t = useT();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestAccepted, setGuestAccepted] = useState(false);

  const load = () => {
    fetch(`/api/invite/${token}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(t("somethingWentWrong")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const respond = async (action: "accept" | "decline", opts: { asGuest?: boolean } = {}) => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...(opts.asGuest ? { asGuest: true } : {}) }),
      });
      const json = await res.json().catch(() => ({ error: t("somethingWentWrong") }));
      if (!res.ok) {
        setError(json.error ?? t("somethingWentWrong"));
        setBusy(false);
        return;
      }
      if (action === "accept" && !data.authenticated) {
        // True anonymous visitor: same-browser memory of the accepted spot (ADR 0026).
        // A logged-in viewer joining "as guest" leaves no marker — this is their account's browser.
        localStorage.setItem(acceptedMarkerKey(token), data.inviteeName);
        setGuestAccepted(true);
      }
      setData({ ...data, status: action === "accept" ? "accepted" : "declined" });
    } catch {
      setError(t("somethingWentWrong"));
    }
    setBusy(false);
  };

  /** Bind an accepted-but-unclaimed guest row to the signed-in account.
   *  NOTE: data.game.id is the EVENT id — claim-player resolves within the event. */
  const bindToMe = async () => {
    if (!data?.game?.id || !data.claimPlayerId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${data.game.id}/claim-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ playerId: data.claimPlayerId }),
      });
      const json = await res.json().catch(() => ({ error: t("somethingWentWrong") }));
      if (!res.ok) {
        setError(json.error ?? t("somethingWentWrong"));
      } else {
        setData({ ...data, claimPlayerId: null });
      }
    } catch {
      setError(t("somethingWentWrong"));
    }
    setBusy(false);
  };



  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data?.valid || data.status === "not_found") {
    return <StatusCard><Alert severity="error">{t("inviteNotFound")}</Alert></StatusCard>;
  }

  if (data.status === "expired") {
    return <StatusCard><Alert severity="warning">{t("inviteExpired")}</Alert></StatusCard>;
  }

  if (data.status === "accepted") {
    const wasGuest = guestAccepted || (!data.authenticated && !!localStorage.getItem(acceptedMarkerKey(token)));
    const unclaimed = !!data.claimPlayerId;
    return (
      <StatusCard>
        <Alert severity="success">
          {wasGuest ? t("inviteYouAreIn", { name: data.inviteeName }) : t("inviteAccepted")}
        </Alert>
        {wasGuest && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("inviteGuestNote")}
          </Typography>
        )}
        <Button variant="contained" href={`/events/${data.game.id}`} sx={{ mt: 2 }} startIcon={<EventAvailableIcon />}>
          {t("inviteViewGame")}
        </Button>
        {unclaimed && data.authenticated && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" fontWeight={700}>{t("inviteClaimTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("inviteClaimDesc", { name: data.inviteeName })}</Typography>
            <Button data-testid="invite-bind-self" variant="outlined" disabled={busy} onClick={bindToMe}>
              {t("inviteClaimBind")}
            </Button>
          </Box>
        )}
        {unclaimed && !data.authenticated && (
          <Box sx={{ mt: 3, textAlign: "left" }}>
            <Typography variant="subtitle2" fontWeight={700}>{t("inviteClaimTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("inviteClaimDesc", { name: data.inviteeName })}</Typography>
            {/* Email capture deliberately withheld from anonymous viewers:
                the players route is organizer-gated and an open mail form is
                a spam vector. Google one-tap is the claim door here (ADR 0026
                as amended); email signup users bind later via the event page. */}
            <Button
              variant="contained"
              startIcon={<HowToRegIcon />}
              href={`/auth/signin?callbackURL=/invite/${token}`}
            >
              {t("inviteClaimGoogle")}
            </Button>
          </Box>
        )}
      </StatusCard>
    );
  }

  if (data.status === "declined" || data.status === "cancelled") {
    return (
      <StatusCard>
        <Alert severity="info">{data.status === "declined" ? t("inviteDeclined") : t("inviteCancelled")}</Alert>
        <Button variant="outlined" href={`/events/${data.game.id}`} sx={{ mt: 2 }}>
          {t("inviteViewGame")}
        </Button>
      </StatusCard>
    );
  }

  // pending — ADR 0026: never a signup wall.
  const gameCard = (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
        {t("inviteInvitedBy").replace("{name}", data.invitedByName)}
      </Typography>
      <Chip data-testid="invite-player-name" label={data.inviteeName} color="primary" sx={{ mb: 1 }} />
      <Box sx={{ mt: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>{data.game.title}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
          {data.game.location && <Chip size="small" label={data.game.location} variant="outlined" />}
          <Chip size="small" label={new Intl.DateTimeFormat(undefined, {
            weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          }).format(new Date(data.game.dateTime))} variant="outlined" />
        </Stack>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    </>
  );

  if (data.claimable && data.authenticated && !data.isInvitee) {
    // Logged-in viewer on a guest link: explicit identity choice (never silent binding).
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: { xs: 2, sm: 4 }, maxWidth: 460, mx: "auto", mt: 4 }}>
        <Typography variant="h6" fontWeight={700}>{t("invitePageTitle")}</Typography>
        {gameCard}
        <Stack spacing={1.5}>
          <Button
            data-testid="invite-join-self"
            variant="contained"
            disabled={busy}
            onClick={() => respond("accept")}
          >
            {t("inviteJoinAsViewer", { name: data.viewerName ?? "" })}
          </Button>
          <Button
            data-testid="invite-join-guest"
            variant="outlined"
            disabled={busy}
            onClick={() => respond("accept", { asGuest: true })}
          >
            {t("inviteJoinAsGuest", { name: data.inviteeName })}
          </Button>
          <Button variant="text" color="inherit" disabled={busy} onClick={() => respond("decline")}>
            {t("inviteDeclineBtn")}
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (data.claimable && !data.authenticated) {
    // Anonymous visitor: zero-friction accept — no account needed.
    return (
      <Paper elevation={3} sx={{ borderRadius: 3, p: { xs: 2, sm: 4 }, maxWidth: 460, mx: "auto", mt: 4 }}>
        <Typography variant="h6" fontWeight={700}>{t("invitePageTitle")}</Typography>
        {gameCard}
        <Alert severity="info" sx={{ mb: 2 }}>{t("inviteNoAccountNeeded")}</Alert>
        <Stack direction="row" spacing={2} justifyContent="center">
          <Button variant="contained" disabled={busy} onClick={() => respond("accept")}>
            {t("inviteAccept")}
          </Button>
          <Button variant="outlined" color="inherit" disabled={busy} onClick={() => respond("decline")}>
            {t("inviteDeclineBtn")}
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (!data.authenticated) {
    // Claimed invite opened while logged out → show the game details alongside
    // the sign-in CTA, then come straight back. No bare login wall.
    return (
      <StatusCard>
        <Typography variant="h6" fontWeight={700}>{t("invitePageTitle")}</Typography>
        {gameCard}
        <Alert severity="info" sx={{ mb: 2 }}>{t("inviteSignInCta")}</Alert>
        <Button
          variant="contained"
          startIcon={<HowToRegIcon />}
          href={`/auth/signin?callbackURL=/invite/${token}`}
        >
          {t("inviteSignIn")}
        </Button>
      </StatusCard>
    );
  }

  if (!data.isInvitee) {
    return <StatusCard><Alert severity="error">{t("inviteNotForYou")}</Alert></StatusCard>;
  }

  return (
    <Paper elevation={3} sx={{ borderRadius: 3, p: { xs: 2, sm: 4 }, maxWidth: 460, mx: "auto", mt: 4 }}>
      <Typography variant="h6" fontWeight={700}>{t("invitePageTitle")}</Typography>
      {gameCard}
      <Stack direction="row" spacing={2} justifyContent="center">
        <Button variant="contained" color="primary" disabled={busy} onClick={() => respond("accept")}>
          {t("inviteAccept")}
        </Button>
        <Button variant="outlined" color="inherit" disabled={busy} onClick={() => respond("decline")}>
          {t("inviteDeclineBtn")}
        </Button>
      </Stack>
    </Paper>
  );
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <Paper elevation={3} sx={{ borderRadius: 3, p: 4, maxWidth: 460, mx: "auto", mt: 4, textAlign: "center" }}>
      {children}
    </Paper>
  );
}
