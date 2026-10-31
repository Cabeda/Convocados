import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  CircularProgress,
  Alert,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import LockIcon from "@mui/icons-material/Lock";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import { apiRequest, ApiError } from "~/lib/api/client";

/** Map scope strings to i18n keys */
const SCOPE_I18N_MAP: Record<string, string> = {
  openid: "oauthConsentScopeOpenid",
  profile: "oauthConsentScopeProfile",
  email: "oauthConsentScopeEmail",
  offline_access: "oauthConsentScopeOfflineAccess",
  "read:profile": "oauthConsentScopeReadProfile",
  "read:events": "oauthConsentScopeReadEvents",
  "write:events": "oauthConsentScopeWriteEvents",
  "create:events": "oauthConsentScopeCreateEvents",
  "manage:players": "oauthConsentScopeManagePlayers",
  "read:ratings": "oauthConsentScopeReadRatings",
  "read:history": "oauthConsentScopeReadHistory",
  "manage:teams": "oauthConsentScopeManageTeams",
  "manage:webhooks": "oauthConsentScopeManageWebhooks",
  "manage:push": "oauthConsentScopeManagePush",
  "read:calendar": "oauthConsentScopeReadCalendar",
  "manage:payments": "oauthConsentScopeManagePayments",
};

export default function OAuthConsentPage() {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<{
    name: string;
    icon: string | null;
  } | null>(null);

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("client_id") ?? "";
  const scopeStr = params.get("scope") ?? "openid";
  const scopes = scopeStr.split(" ").filter(Boolean);

  // Fetch client info on mount
  useEffect(() => {
    if (!clientId) return;
    apiRequest("GET /api/auth/oauth2/public-client", {
      query: { client_id: clientId },
      init: { credentials: "include" },
    })
      .then((body) => {
        const data = body as { client_name?: string; logo_uri?: string | null } | undefined;
        if (data) setClientInfo({ name: data.client_name ?? clientId, icon: data.logo_uri ?? null });
        else setClientInfo({ name: clientId, icon: null });
      })
      .catch(() => setClientInfo({ name: clientId, icon: null }));
  }, [clientId]);

  async function handleConsent(accept: boolean) {
    setLoading(true);
    setError(null);
    try {
      // The signed authorization request, exactly as the AS sent it. The
      // consent endpoint reads it back from the body — without it there is no
      // request to consent to, and the approval fails.
      const oauthQuery = window.location.search.replace(/^\?/, "");
      const data = (await apiRequest("POST /api/auth/oauth2/consent", {
        body: { accept, oauth_query: oauthQuery },
        init: { credentials: "include" },
      })) as { url?: string };
      // The AS answers with the URL the browser must continue to: the client's
      // redirect URI carrying the authorization code.
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      const body = (e instanceof ApiError ? e.payload : undefined) as
        | { error_description?: string; message?: string; error?: string }
        | undefined;
      setError(
        body?.error_description ??
          body?.message ??
          body?.error ??
          (e instanceof ApiError ? "Consent request failed" : "Network error. Please try again."),
      );
      setLoading(false);
    }
  }

  const appName = clientInfo?.name ?? clientId;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 440, width: "100%" }}>
        <CardContent sx={{ p: 3 }}>
          {/* Header */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            {clientInfo?.icon ? (
              <Avatar src={clientInfo.icon} alt={appName} sx={{ width: 48, height: 48 }} />
            ) : (
              <Avatar sx={{ width: 48, height: 48, bgcolor: "primary.main" }}>
                <LockIcon />
              </Avatar>
            )}
            <Box>
              <Typography variant="h6" component="h1">
                {t("oauthConsentTitle").replace("{appName}", appName)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("oauthConsentDescription").replace("{appName}", appName)}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Scopes */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t("oauthConsentScopesLabel")}
          </Typography>
          <List dense disablePadding>
            {scopes.map((scope) => {
              const i18nKey = SCOPE_I18N_MAP[scope];
              const label = i18nKey ? t(i18nKey as TranslationKey) : scope;
              return (
                <ListItem key={scope} disableGutters sx={{ py: 0.25 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <CheckCircleOutlineIcon fontSize="small" color="success" />
                  </ListItemIcon>
                  <ListItemText primary={label} slotProps={{
                    primary: { variant: "body2" }
                  }} />
                </ListItem>
              );
            })}
          </List>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {/* Actions */}
          <Box sx={{ display: "flex", gap: 2, mt: 3 }}>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => handleConsent(false)}
              disabled={loading}
            >
              {t("oauthConsentDeny")}
            </Button>
            <Button
              variant="contained"
              fullWidth
              onClick={() => handleConsent(true)}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : undefined}
            >
              {t("oauthConsentAllow")}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
