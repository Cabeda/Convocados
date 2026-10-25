import { useState, useEffect, useCallback } from "react";
import {
  Paper, Typography, Stack, Button, Alert, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, Divider,
} from "@mui/material";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import GoogleIcon from "@mui/icons-material/Google";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { dateFormatTag } from "~/lib/timezones";
import { authClient } from "~/lib/auth.client";
import { apiRequest, ApiError } from "~/lib/api/client";

interface CredentialView {
  id: string;
  providerId: string;
  accountId: string;
  issuer: string | null;
  createdAt: string;
}

interface PendingMergeView {
  absorbedUserId: string;
  absorbedEmail: string;
  absorbedName: string;
  absorbedCreatedAt: string;
  absorbedEventCount: number;
  providerId: string;
  accountId: string;
}

function providerLabel(t: ReturnType<typeof useT>, providerId: string): string {
  if (providerId === "credential") return t("credentialPassword");
  if (providerId === "google") return t("credentialGoogle");
  return providerId;
}

function providerIcon(providerId: string) {
  if (providerId === "credential") return <KeyIcon fontSize="small" color="action" />;
  if (providerId === "google") return <GoogleIcon fontSize="small" color="action" />;
  return <LinkIcon fontSize="small" color="action" />;
}

/**
 * Linked sign-in methods (ADR 0040): list Credentials, link Google via
 * better-auth linkSocial, unlink with sole-credential guard, and show the
 * cross-account merge interstitial when a conflict was captured.
 */
export function LinkedCredentialsSection({ profilePath }: { profilePath?: string }) {
  const t = useT();
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PendingMergeView | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = (await apiRequest("GET /api/me/credentials", {
        init: { credentials: "include" },
      })) as { credentials?: CredentialView[] };
      setCredentials(body.credentials ?? []);

      try {
        const mergeBody = (await apiRequest("GET /api/me/credentials/pending-merge", {
          init: { credentials: "include" },
        })) as { pendingMerge?: PendingMergeView };
        if (mergeBody.pendingMerge) {
          setPendingMerge(mergeBody.pendingMerge);
          setMergeDialogOpen(true);
        }
      } catch (e) {
        // An absent merge is not a failure; a network error still surfaces.
        if (!(e instanceof ApiError)) throw e;
      }
      setError(null);
    } catch {
      setError(t("credentialLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface OAuth link result from callbackURL (?linked=1 / ?error=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("linked");
    const err = params.get("error");
    if (linked === "1") {
      setSnackbar(t("linkGoogleSuccess"));
      params.delete("linked");
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    } else if (err) {
      if (err === "account_already_linked_to_different_user") {
        // Capture may have been written server-side — load will open the dialog.
        void load();
      } else {
        setError(t("linkGoogleError"));
      }
      params.delete("error");
      params.delete("error_description");
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, [load, t]);

  const hasGoogle = credentials.some((c) => c.providerId === "google");
  const sole = credentials.length <= 1;

  const handleLinkGoogle = async () => {
    setLinking(true);
    setError(null);
    try {
      const callbackURL =
        profilePath ??
        (typeof window !== "undefined"
          ? `${window.location.pathname}?linked=1`
          : "/?linked=1");
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL,
        errorCallbackURL: callbackURL.replace("linked=1", "error=link_failed"),
      });
      if (result.error) {
        setError(t("linkGoogleError"));
        setLinking(false);
        return;
      }
      // Redirect flow: browser navigates away. disableRedirect would leave us here.
      if (result.data && "redirect" in result.data && result.data.redirect === false) {
        setLinking(false);
        await load();
      }
    } catch {
      setError(t("linkGoogleError"));
      setLinking(false);
    }
  };

  const handleUnlink = async (accountId: string) => {
    setError(null);
    try {
      await apiRequest("DELETE /api/me/credentials", {
        body: { accountId },
        init: { credentials: "include" },
      });
      setSnackbar(t("credentialUnlinked"));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("credentialUnlinkError"));
    }
  };

  const handleMergeConfirm = async () => {
    setMerging(true);
    setError(null);
    try {
      await apiRequest("POST /api/me/credentials/merge", {
        body: { confirm: true },
        init: { credentials: "include" },
      });
      setMergeDialogOpen(false);
      setPendingMerge(null);
      setSnackbar(t("mergeSuccess"));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("mergeError"));
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <LinkIcon fontSize="small" color="action" />
            <Typography variant="h6" fontWeight={600}>{t("linkedSignIns")}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">{t("linkedSignInsDesc")}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {loading ? (
            <Typography variant="body2" color="text.secondary">…</Typography>
          ) : (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {credentials.map((cred) => (
                <Stack key={cred.id} direction="row" alignItems="center" spacing={1.5}>
                  {providerIcon(cred.providerId)}
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {providerLabel(t, cred.providerId)}
                  </Typography>
                  {sole ? (
                    <Chip size="small" label={t("onlyCredentialHint")} color="info" variant="outlined" />
                  ) : (
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => handleUnlink(cred.id)}
                    >
                      {t("unlinkCredentialBtn")}
                    </Button>
                  )}
                </Stack>
              ))}
              {!hasGoogle && (
                <Button
                  variant="outlined"
                  startIcon={<GoogleIcon />}
                  onClick={handleLinkGoogle}
                  disabled={linking}
                >
                  {t("linkGoogleBtn")}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Dialog open={mergeDialogOpen} onClose={() => !merging && setMergeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("mergeConfirmTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2">
              {pendingMerge &&
                t("mergeConfirmDesc", {
                  email: pendingMerge.absorbedEmail,
                  date: new Date(pendingMerge.absorbedCreatedAt).toLocaleDateString(dateFormatTag(detectLocale())),
                })}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialogOpen(false)} disabled={merging}>
            {t("mergeCancelBtn")}
          </Button>
          <Button onClick={handleMergeConfirm} variant="contained" disabled={merging}>
            {merging ? "…" : t("mergeConfirmBtn")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar ?? ""}
      />
    </>
  );
}
