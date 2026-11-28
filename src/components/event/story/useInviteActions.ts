import { useCallback, useState } from "react";
import { ApiError, apiErrorMessage, apiRequest } from "~/lib/api/client";
import { useT } from "~/lib/useT";
import type { TFunction } from "~/lib/i18n";

export interface InviteRef { id: string; inviteId?: string | null; name: string }

/** "email, web push" — the channels an invite just went out through, in the viewer's words. */
export function channelLabels(channels: unknown, t: TFunction): string[] {
  const c = channels as { email?: boolean; webPush?: boolean; appPush?: boolean } | undefined;
  return [c?.email && t("channelEmail"), c?.webPush && t("channelWebPush"), c?.appPush && t("channelAppPush")].filter(Boolean) as string[];
}

/** What the page does with a pending invite after it is sent. */
export interface InviteActionsArgs {
  eventId: string;
  refetch: () => Promise<void>;
  notify: (message: string) => void;
}

/** Resend (24 h cooldown, kept by the server) and retract a pending invite. One at a time per invite. */
export function useInviteActions({ eventId, refetch, notify }: InviteActionsArgs) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [retractingId, setRetractingId] = useState<string | null>(null);

  const resend = useCallback(async (invite: InviteRef) => {
    const inviteId = invite.inviteId ?? invite.id;
    if (resendingId) return;
    setResendingId(inviteId);
    setError(null);
    try {
      const json = (await apiRequest("PATCH /api/events/{id}/invites", { params: { id: eventId }, body: { inviteId } })) as { channels?: unknown };
      const labels = channelLabels(json?.channels, t);
      notify(labels.length > 0 ? t("inviteResentVia", { name: invite.name, channels: labels.join(", ") }) : t("inviteSent", { name: invite.name }));
      await refetch();
    } catch (e) {
      const retryAfter = e instanceof ApiError && e.status === 429 ? (e.payload as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds : undefined;
      if (typeof retryAfter === "number") {
        const mins = Math.ceil(retryAfter / 60);
        notify(t("inviteResendCooldown", { time: mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m` }));
      } else {
        setError(apiErrorMessage(e, t("somethingWentWrong")));
      }
    } finally {
      setResendingId(null);
    }
  }, [eventId, notify, refetch, resendingId, t]);

  const retract = useCallback(async (invite: InviteRef) => {
    const inviteId = invite.inviteId ?? invite.id;
    if (retractingId || !window.confirm(t("inviteRetractConfirm", { name: invite.name }))) return;
    setRetractingId(inviteId);
    setError(null);
    try {
      await apiRequest("DELETE /api/events/{id}/invites", { params: { id: eventId }, body: { inviteId } });
      notify(t("inviteRetracted", { name: invite.name }));
      await refetch();
    } catch (e) {
      setError(apiErrorMessage(e, t("somethingWentWrong")));
    } finally {
      setRetractingId(null);
    }
  }, [eventId, notify, refetch, retractingId, t]);

  return { error, clearError: useCallback(() => setError(null), []), resendingId, retractingId, resend, retract };
}
