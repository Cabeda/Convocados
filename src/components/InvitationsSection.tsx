import { useState } from "react";
import { Paper, Typography, Button, Stack, Alert, Box, Chip } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { useT } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";

export interface HomeInvitation {
  id: string;
  token: string;
  eventId: string;
  eventTitle: string;
  location: string;
  dateTime: string;
  sport: string;
  invitedByName: string;
}

export interface HomeRosterAdd {
  id: string;
  eventId: string;
  eventTitle: string;
  location: string;
  dateTime: string;
  sport: string;
}

interface Props {
  invitations: HomeInvitation[];
  rosterAdds: HomeRosterAdd[];
  locale?: string;
}

/**
 * Home inbox for "someone wants you in a game".
 *
 * Two kinds, deliberately treated differently:
 *  - a pending invitation asks a question — Accept / Decline;
 *  - a direct add already put you on the list — there is nothing to answer, so
 *    it is an acknowledgement you can Dismiss (persisted per Event in
 *    localStorage, matching how the Season Rank reveal is dismissed).
 */
export function InvitationsSection({ invitations, rosterAdds, locale = "en" }: Props) {
  const t = useT();
  const [pending, setPending] = useState(invitations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which direct adds have been acknowledged on this device.
  const [acked, setAcked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const add of rosterAdds) {
      if (typeof window !== "undefined" && window.localStorage.getItem(`roster-add-ack:${add.eventId}`)) {
        initial[add.eventId] = true;
      }
    }
    return initial;
  });

  const visibleAdds = rosterAdds.filter((a) => !acked[a.eventId]);

  const respond = async (invitation: HomeInvitation, action: "accept" | "decline") => {
    setBusyId(invitation.id);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${invitation.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("failed");
      setPending((prev) => prev.filter((i) => i.id !== invitation.id));
    } catch {
      setError(t("invitationsError"));
    } finally {
      setBusyId(null);
    }
  };

  const dismissAdd = (add: HomeRosterAdd) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`roster-add-ack:${add.eventId}`, "1");
    }
    setAcked((prev) => ({ ...prev, [add.eventId]: true }));
  };

  if (pending.length === 0 && visibleAdds.length === 0) return null;

  const dateFor = (iso: string) =>
    formatDateInTz(new Date(iso), locale === "pt" ? "pt-PT" : "en-GB", "UTC", {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <Box data-testid="invitations-section">
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t("invitationsTitle")}
      </Typography>

      {error && (
        <Alert severity="error" data-testid="invitations-error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={1.5}>
        {pending.map((invitation) => (
          <Paper key={invitation.id} elevation={2} sx={{ borderRadius: 3, p: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t("inviteInvitedBy").replace("{name}", invitation.invitedByName)}
            </Typography>
            <Typography variant="subtitle1" fontWeight={700}>
              {invitation.eventTitle}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, mb: 1.5, flexWrap: "wrap", gap: 0.5 }}>
              {invitation.location && <Chip size="small" label={invitation.location} variant="outlined" />}
              <Chip size="small" label={dateFor(invitation.dateTime)} variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                data-testid={`invite-accept-${invitation.id}`}
                size="small"
                variant="contained"
                startIcon={<CheckIcon />}
                disabled={busyId === invitation.id}
                onClick={() => respond(invitation, "accept")}
              >
                {t("inviteAccept")}
              </Button>
              <Button
                data-testid={`invite-decline-${invitation.id}`}
                size="small"
                variant="outlined"
                startIcon={<CloseIcon />}
                disabled={busyId === invitation.id}
                onClick={() => respond(invitation, "decline")}
              >
                {t("inviteDeclineBtn")}
              </Button>
            </Stack>
          </Paper>
        ))}

        {visibleAdds.map((add) => (
          <Paper
            key={add.id}
            elevation={1}
            sx={{ borderRadius: 3, p: 2, borderLeft: 4, borderColor: "primary.main" }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <PersonAddIcon fontSize="small" color="primary" />
              <Typography variant="body2" color="text.secondary">
                {t("rosterAddedYou")}
              </Typography>
            </Stack>
            <Typography variant="subtitle1" fontWeight={700}>
              {add.eventTitle}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, mb: 1.5, flexWrap: "wrap", gap: 0.5 }}>
              {add.location && <Chip size="small" label={add.location} variant="outlined" />}
              <Chip size="small" label={dateFor(add.dateTime)} variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" href={`/events/${add.eventId}`}>
                {t("inviteViewGame")}
              </Button>
              <Button
                data-testid={`roster-add-dismiss-${add.id}`}
                size="small"
                variant="text"
                onClick={() => dismissAdd(add)}
              >
                {t("dismiss")}
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
