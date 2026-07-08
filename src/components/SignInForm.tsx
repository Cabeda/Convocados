import React, { useState } from "react";
import {
  TextField, Button, Stack, Alert, Link, Divider, Tabs, Tab, Box,
} from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import EmailIcon from "@mui/icons-material/Email";
import { useT } from "~/lib/useT";
import { signIn } from "~/lib/auth.client";

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
 * Google sign-in always uses the plain top-level redirect flow on every
 * platform — including iOS PWA. The earlier popup flow was removed because
 * `window.open` on iOS always opens Safari/SFSafariViewController, which has
 * a separate cookie jar from the standalone PWA, so the session cookie was
 * lost. A same-window top-level redirect stays inside the PWA's browsing
 * context on iOS 16.4+.
 *
 * ponytail: iOS < 16.4 may still hand the cross-origin Google redirect to
 * Safari (cookie lost). Those users fall back to email/password. Upgrade
 * path: Sign in with Apple JS (in-jar, needs Apple Developer credentials).
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
    // Plain top-level redirect on every platform (see component doc comment).
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
