import { useEffect, useId, useState } from "react";
import { Box, Button, Chip, Typography } from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useT } from "~/lib/useT";
import { waitingCounts } from "~/lib/nextGame";
import { earliestResendAt, formatCooldown, resendEligibility, sentChannels } from "~/lib/inviteDisplay";
import type { EventData } from "../types";
import { AnonymousPlayerIcon, PlayerAvatar } from "../PlayerIdentity";
import { tappable } from "./styles";
import type { InviteRef } from "./useInviteActions";

type Invited = NonNullable<EventData["invited"]>[number];
type Declined = NonNullable<EventData["declined"]>[number];

interface Props {
  invited: readonly Invited[];
  declined: readonly Declined[];
  /** Owner or admin: may resend and cancel. */
  canManage: boolean;
  resendingId: string | null;
  retractingId: string | null;
  onResend: (invite: InviteRef) => void;
  onRetract: (invite: InviteRef) => void;
}

function Who({ name, userId, image }: { name: string; userId: string | null; image?: string | null }) {
  const t = useT();
  return userId
    ? <PlayerAvatar userId={userId} name={name} image={image ?? null} size={22} clickable={false} />
    : <span title={t("anonymousPlayer")}><AnonymousPlayerIcon /></span>;
}

/** Pending invites and declines, collapsed into one line: "2 invited · 1 can't make it". */
export function WaitingRow({ invited, declined, canManage, resendingId, retractingId, onResend, onRetract }: Props) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  // The cooldown ("Resend in 23h 5m") is kept fresh while the list is open, by one timer a minute.
  const [now, setNow] = useState(() => Date.now());
  const cooling = earliestResendAt(invited.map((i) => i.notifiedAt), now) !== null;
  useEffect(() => {
    if (!open || !cooling) return;
    const timer = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 60_000);
    return () => clearInterval(timer);
  }, [open, cooling]);

  const counts = waitingCounts(invited.length, declined.length);
  if (!counts.any) return null;
  const summary = [
    counts.invited > 0 && t("ngWaitingInvited", { n: counts.invited }),
    counts.declined > 0 && t("ngWaitingDeclined", { n: counts.declined }),
  ].filter(Boolean).join(" · ");

  return (
    <Box sx={{ mt: 0.5 }}>
      <Button
        aria-expanded={open} aria-controls={id} onClick={() => { setNow(Date.now()); setOpen((o) => !o); }}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        sx={{ minHeight: 44, ml: -1.5, px: 1.5, textTransform: "none", fontSize: "1rem", fontWeight: 700, color: "text.secondary", borderRadius: 999, ...tappable }}
      >
        {summary}
      </Button>
      {open && (
        <Box id={id} data-testid="waiting-list">
          {invited.length > 0 && (
            <Box component="section" aria-label={t("ngInvitedHeading")}>
              <Typography component="h3" sx={{ fontSize: "0.875rem", fontWeight: 600, color: "text.secondary" }}>{t("ngInvitedHeading")}</Typography>
              {invited.map((inv) => {
                const inviteId = inv.inviteId ?? inv.id;
                const channels = sentChannels(inv.channels);
                const cool = resendEligibility(inv.notifiedAt, now);
                return (
                  <Box key={inv.id} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, borderTop: 1, borderColor: "divider", minHeight: 52, py: 0.5 }}>
                    <Who name={inv.name} userId={inv.userId} image={inv.image} />
                    <Box sx={{ flex: "1 1 8rem", minWidth: 0 }}>
                      <Typography sx={{ fontSize: "1rem", lineHeight: 1.35, overflowWrap: "anywhere" }}>{inv.name}</Typography>
                      <Typography component="div" sx={{ fontSize: "0.875rem", color: "text.secondary", display: "flex", flexWrap: "wrap", gap: 0.5 }} data-testid={`invite-how-${inviteId}`}>
                        {channels.length > 0
                          ? channels.map((c) => <Chip key={c.key} size="small" variant="outlined" label={t(c.labelKey)} data-testid={`invite-channel-${c.key}-${inviteId}`} />)
                          : t("ngInvitedByLink")}
                      </Typography>
                    </Box>
                    {canManage && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", marginLeft: "auto" }}>
                        <Button
                          size="small" disabled={!cool.eligible || resendingId === inviteId} data-testid={`resend-invite-${inviteId}`}
                          aria-label={t("inviteResendAria", { name: inv.name })} onClick={() => onResend({ id: inv.id, inviteId: inv.inviteId, name: inv.name })}
                          sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}
                        >
                          {cool.eligible ? t("ngResend") : t("ngResendIn", { time: formatCooldown(cool.remainingMs) })}
                        </Button>
                        <Button
                          size="small" color="error" disabled={retractingId === inviteId} data-testid={`retract-invite-${inviteId}`}
                          aria-label={t("inviteRetractAria", { name: inv.name })} onClick={() => onRetract({ id: inv.id, inviteId: inv.inviteId, name: inv.name })}
                          sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}
                        >
                          {t("ngRetract")}
                        </Button>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
          {declined.length > 0 && (
            <Box component="section" aria-label={t("ngDeclinedHeading")} sx={{ mt: invited.length > 0 ? 1 : 0 }}>
              <Typography component="h3" sx={{ fontSize: "0.875rem", fontWeight: 600, color: "text.secondary" }}>{t("ngDeclinedHeading")}</Typography>
              {declined.map((d) => (
                <Box key={d.id} sx={{ display: "flex", alignItems: "center", gap: 1, borderTop: 1, borderColor: "divider", minHeight: 44 }}>
                  <Who name={d.name} userId={d.userId} image={d.image} />
                  <Typography sx={{ fontSize: "1rem", color: "text.secondary", overflowWrap: "anywhere" }}>{d.name}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
