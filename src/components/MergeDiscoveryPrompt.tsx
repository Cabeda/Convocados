import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useSession } from "~/lib/auth.client";
import { useT } from "~/lib/useT";

interface PendingMerge {
  absorbedUserId: string;
  absorbedEmail: string;
  absorbedName: string;
  absorbedCreatedAt: string;
  absorbedEventCount: number;
  providerId: string;
  accountId: string;
}

/**
 * First-run cross-account merge discovery (ADR 0040, GH #1128).
 *
 * The merge capture is written server-side when an OAuth link hits an account
 * that already exists. Previously the interstitial only rendered on the profile
 * page; this prompt is mounted app-wide so a pending merge surfaces wherever
 * the callback lands — including flows that only carry
 * `?error=account_already_linked_to_different_user`.
 *
 * Mounted per app surface (see `mergePrompt` on BaseLayout), not in the shared
 * layout body, so anonymous/docs pages never ship the island.
 */
export default function MergeDiscoveryPrompt() {
  const t = useT();
  const { data: session, isPending } = useSession();
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/credentials/pending-merge", { credentials: "include" });
      if (!res.ok) return;
      const body = await res.json();
      if (body.pendingMerge) {
        setPending(body.pendingMerge);
        setOpen(true);
      }
    } catch {
      /* non-fatal: the profile section also surfaces this */
    }
  }, []);

  // Check once the session is known, and again when a link error lands on any
  // page (the capture is written server-side, so we re-read the endpoint).
  useEffect(() => {
    if (isPending || !session?.user) return;
    void load();
  }, [isPending, session?.user, load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "account_already_linked_to_different_user") {
      void load();
    }
  }, [load]);

  if (!pending) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/credentials/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        credentials: "include",
      });
      if (!res.ok) {
        setError(t("mergeError"));
        return;
      }
      setOpen(false);
      setPending(null);
      // Data ownership moved to this account; a reload shows the merged state.
      if (typeof window !== "undefined") window.location.reload();
    } catch {
      setError(t("mergeError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{t("mergeConfirmTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2">
            {t("mergeConfirmDesc", {
              email: pending.absorbedEmail,
              date: new Date(pending.absorbedCreatedAt).toLocaleDateString(),
            })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(false)} disabled={busy}>
          {t("mergeCancelBtn")}
        </Button>
        <Button onClick={confirm} variant="contained" disabled={busy}>
          {busy ? "…" : t("mergeConfirmBtn")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
