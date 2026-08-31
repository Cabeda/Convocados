import React, { useState } from "react";
import {
  TextField, Button, Stack, Alert, Link, Divider, Tabs, Tab, Box,
} from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import EmailIcon from "@mui/icons-material/Email";
import { useT } from "~/lib/useT";
import { signIn } from "~/lib/auth.client";
import { isIosPwa } from "~/lib/pwaDetect";

type GoogleIdentityCredential = { credential: string };
type GoogleIdentityServices = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleIdentityCredential) => void;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
};

type GoogleWindow = Window & {
  google?: { accounts?: { id?: GoogleIdentityServices } };
};

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";

function getGoogleIdentityServices(): GoogleIdentityServices | undefined {
  return (window as GoogleWindow).google?.accounts?.id;
}

function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  const loaded = getGoogleIdentityServices();
  if (loaded) return Promise.resolve(loaded);

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`,
    );
    const script = existingScript ?? document.createElement("script");
    const onLoad = () => {
      const services = getGoogleIdentityServices();
      if (services) resolve(services);
      else reject(new Error("Google Identity Services did not initialize"));
    };
    const onError = () => {
      script.remove();
      reject(new Error("Google Identity Services failed to load"));
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existingScript) {
      script.async = true;
      script.defer = true;
      script.src = GOOGLE_IDENTITY_SCRIPT;
      document.head.appendChild(script);
    }
  });
}

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box>{children}</Box> : null;
}

export interface SignInFormProps {
  /** Relative path to return to after a Google redirect / where to send the user on success. */
  callbackURL: string;
  /**
   * Called after a successful email/password sign-in. When provided (modal use)
   * the form does NOT navigate — the caller closes the dialog and revalidates the
   * session in place. When omitted (full-page use) the form navigates to `callbackURL`.
   */
  onSuccess?: () => void;
  /** Show the "no account → sign up" footer link. Default true. */
  showSignUpLink?: boolean;
}

/**
 * Shared sign-in form body: Google button + magic-link / password tabs.
 *
 * Used both by the full-page `SignInPage` and the in-place `SignInModal`.
 * The only context-dependent behaviour is what happens on success:
 *   - full page → `window.location.href = callbackURL`
 *   - modal     → `onSuccess()` (close + revalidate, no navigation)
 *
 * Google sign-in uses the Google Identity Services ID-token flow in an
 * installed iOS PWA. That flow keeps Google authentication and the resulting
 * same-origin session cookie inside the PWA's cookie jar. Other platforms use
 * better-auth's normal top-level redirect flow.
 */
export function SignInForm({ callbackURL, onSuccess, showSignUpLink = true }: SignInFormProps) {
  const t = useT();
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [gisError, setGisError] = useState(false);
  const gisContainerRef = React.useRef<HTMLDivElement>(null);
  const authErrorMessage = t("authError");
  const useGoogleIdentityServices = isIosPwa();
  const safeCallbackURL = callbackURL.startsWith("/") && !callbackURL.startsWith("//") && !callbackURL.includes("\\")
    ? callbackURL
    : "/dashboard";

  const handleGoogleCredential = React.useCallback(async (credential: string) => {
    setError(null);
    setGisError(false);
    setLoading(true);
    try {
      const result = await signIn.social({
        provider: "google",
        idToken: { token: credential },
      });
      if (result.error) {
        setError(authErrorMessage);
      } else if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = safeCallbackURL;
      }
    } catch {
      setError(authErrorMessage);
    } finally {
      setLoading(false);
    }
  }, [authErrorMessage, onSuccess, safeCallbackURL]);

  React.useEffect(() => {
    if (!useGoogleIdentityServices) return;

    let cancelled = false;
    const controller = new AbortController();
    const initializeGoogleIdentityServices = async () => {
      try {
        const response = await fetch("/api/auth/google-client-id", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Google client ID request failed");
        const body = await response.json() as { clientId?: unknown };
        if (typeof body.clientId !== "string" || !body.clientId) {
          throw new Error("Google client ID is not configured");
        }

        const googleIdentity = await loadGoogleIdentityServices();
        if (cancelled || !gisContainerRef.current) return;

        googleIdentity.initialize({
          client_id: body.clientId,
          callback: ({ credential }) => void handleGoogleCredential(credential),
        });
        googleIdentity.renderButton(gisContainerRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
        });
      } catch {
        if (!cancelled && !controller.signal.aborted) setGisError(true);
      }
    };

    void initializeGoogleIdentityServices();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [handleGoogleCredential, useGoogleIdentityServices]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        const code = (result.error.code ?? "").toUpperCase();
        if (code === "EMAIL_NOT_VERIFIED") {
          setUnverified(true);
          setError(t("emailNotVerified"));
        } else {
          setError(t("authError"));
        }
      } else if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = callbackURL;
      }
    } catch {
      setError(t("authError"));
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMagicLinkSent(false);
    setLoading(true);
    try {
      const result = await signIn.magicLink({ email, callbackURL });
      if (result.error) {
        setError(t("magicLinkError"));
      } else {
        setMagicLinkSent(true);
      }
    } catch {
      setError(t("magicLinkError"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    await signIn.social({ provider: "google", callbackURL });
  };

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
    setError(null);
    setUnverified(false);
    setMagicLinkSent(false);
  };

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}
      {unverified && email && (
        <Alert severity="info">
          <Link href={`/auth/verify-email?email=${encodeURIComponent(email)}`} underline="hover">
            {t("resendVerification")}
          </Link>
        </Alert>
      )}
      {magicLinkSent && (
        <Alert severity="success">
          {t("magicLinkSent").replace("{email}", email)}
        </Alert>
      )}

      {useGoogleIdentityServices ? (
        <>
          <Box
            ref={gisContainerRef}
            data-testid="google-gis-signin"
            aria-label={t("signInWithGoogle")}
            sx={{ minHeight: 44, display: "flex", justifyContent: "center" }}
          />
          {gisError && (
            <Alert severity="info">{t("authError")}</Alert>
          )}
        </>
      ) : (
        <Button
          variant="outlined"
          size="large"
          fullWidth
          startIcon={<GoogleIcon />}
          onClick={handleGoogleSignIn}
          type="button"
          data-testid="google-signin"
        >
          {t("signInWithGoogle")}
        </Button>
      )}

      <Divider>{t("or")}</Divider>

      <Tabs value={tab} onChange={handleTabChange} variant="fullWidth" sx={{ minHeight: 40 }}>
        <Tab
          icon={<EmailIcon sx={{ fontSize: 18 }} />}
          iconPosition="start"
          label={t("signInWithEmail")}
          sx={{ minHeight: 40, textTransform: "none" }}
        />
        <Tab label={t("signInWithPassword")} sx={{ minHeight: 40, textTransform: "none" }} />
      </Tabs>

      {/* Magic link tab */}
      <TabPanel value={tab} index={0}>
        <Stack spacing={3} component="form" action="#" method="post" onSubmit={handleMagicLinkSubmit}>
          <TextField
            label={t("email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            autoComplete="email"
          />
          <Button type="submit" variant="contained" size="large" disabled={loading || magicLinkSent} fullWidth>
            {loading ? t("sendingMagicLink") : t("magicLinkBtn")}
          </Button>
        </Stack>
      </TabPanel>

      {/* Password tab */}
      <TabPanel value={tab} index={1}>
        <Stack spacing={3} component="form" action="#" method="post" onSubmit={handlePasswordSubmit}>
          <TextField
            label={t("email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            autoComplete="email"
          />
          <TextField
            label={t("password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            autoComplete="current-password"
          />
          <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth>
            {loading ? t("signingIn") : t("signIn")}
          </Button>
        </Stack>
      </TabPanel>

      {showSignUpLink && (
        <Box textAlign="center">
          <Link href={`/auth/signup?callbackURL=${encodeURIComponent(callbackURL)}`} underline="hover" variant="body2">
            {t("noAccount")} {t("signUp")}
          </Link>
        </Box>
      )}
    </Stack>
  );
}
