import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack, Alert, Link, Divider, Tabs, Tab, Box,
} from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import EmailIcon from "@mui/icons-material/Email";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { signIn, useSession } from "~/lib/auth.client";
import { isIosPwa } from "~/lib/pwaDetect";

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box>{children}</Box> : null;
}

export default function SignInPage() {
  const t = useT();
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // iOS PWA detection: on iOS the PWA and Safari have separate cookie jars,
  // so any auth flow that opens a different browser context (Google OAuth
  // redirect, magic link email, Apple popup) sets the session cookie in
  // Safari's jar — the PWA stays logged out. The ONLY sign-in method that
  // works on iOS PWA is the email/password form (same-origin POST).
  //
  // On iOS PWA we:
  // - hide Google sign-in and the magic-link tab (they don't work)
  // - default to the password tab so the user lands on the working option
  // - skip the misleading "popup will open" notice from the previous attempt
  const iosPwa = typeof window !== "undefined" && isIosPwa();
  // Tab state is only used on non-iOS-PWA (where the tabbed UI is shown).
  // iOS PWA renders the password form directly without tabs.
  const [tab, setTab] = useState(0);

  const rawCallback = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("callbackURL") || "/"
    : "/";

  // Sanitize callbackURL: only allow relative paths to prevent open redirects
  const callbackURL = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";

  const hasCallbackURL = typeof window !== "undefined" && !!new URLSearchParams(window.location.search).get("callbackURL");

  if (typeof window !== "undefined" && !hasCallbackURL) {
    // ADR-0012: missing callbackURL means the user landed on /auth/signin without
    // a deep-link entry point — they'll be redirected to /dashboard after signin.
    // Log so the upstream link rot (push notification, share link, email link) is visible.
    console.warn("[SignInPage] no callbackURL on /auth/signin — post-login destination will fall back to /dashboard");
  }

  // iOS PWA detection moved above (needed before useState for the default tab).

  // Compute the safe post-login destination
  const postLoginURL = callbackURL === "/" ? "/dashboard" : callbackURL;

  // Redirect already-authenticated users
  React.useEffect(() => {
    if (!isPending && session?.user) {
      window.location.href = postLoginURL;
    }
  }, [isPending, session, postLoginURL]);

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
      } else {
        window.location.href = postLoginURL;
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
    // Google sign-in is not available on iOS PWA (the button is hidden in
    // the render below). On desktop and regular mobile Safari the standard
    // redirect flow works — the callback lands in the same browser context,
    // so the session cookie is set in the right jar.
    await signIn.social({ provider: "google", callbackURL });
  };

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
    setError(null);
    setUnverified(false);
    setMagicLinkSent(false);
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="xs" sx={{ py: 8 }}>
          <Paper elevation={2} sx={{ borderRadius: 3, p: 4 }}>
            <Stack spacing={3}>
              <Typography variant="h5" fontWeight={700} textAlign="center">
                {t("signIn")}
              </Typography>

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

              {!iosPwa && (
                <>
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
                </>
              )}

              {/* iOS PWA only shows the password tab — Google and magic link
                  open Safari for auth, and Safari's cookie jar is separate
                  from the PWA's, so the session would never reach the PWA.
                  The Tabs bar is skipped entirely on iOS PWA since there's
                  only one option. */}
              {!iosPwa && (
                <Tabs
                  value={tab}
                  onChange={handleTabChange}
                  variant="fullWidth"
                  sx={{ minHeight: 40 }}
                >
                  <Tab
                    icon={<EmailIcon sx={{ fontSize: 18 }} />}
                    iconPosition="start"
                    label={t("signInWithEmail")}
                    sx={{ minHeight: 40, textTransform: "none" }}
                  />
                  <Tab
                    label={t("signInWithPassword")}
                    sx={{ minHeight: 40, textTransform: "none" }}
                  />
                </Tabs>
              )}

              {/* iOS PWA: render only the password form (the only auth method
                  that works due to cookie-jar isolation). On all other
                  platforms, use the tabbed interface with both options. */}
              {iosPwa ? (
                <Stack
                  spacing={3}
                  component="form"
                  action="#"
                  method="post"
                  onSubmit={handlePasswordSubmit}
                  data-testid="ios-pwa-password-form"
                >
                  <TextField
                    label={t("email")}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    fullWidth
                    autoComplete="email"
                    autoFocus
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
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={loading}
                    fullWidth
                  >
                    {loading ? t("signingIn") : t("signIn")}
                  </Button>
                </Stack>
              ) : (
                <>
                  {/* Magic link tab */}
                  <TabPanel value={tab} index={0}>
                    <Stack spacing={3} component="form" action="#" method="post" onSubmit={handleMagicLinkSubmit}>
                      <Typography variant="body2" color="text.secondary">
                        {t("magicLinkDesc")}
                      </Typography>
                      <TextField
                        label={t("email")}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        fullWidth
                        autoComplete="email"
                        autoFocus
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loading || magicLinkSent}
                        fullWidth
                      >
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
                        autoFocus
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
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loading}
                        fullWidth
                      >
                        {loading ? t("signingIn") : t("signIn")}
                      </Button>
                    </Stack>
                  </TabPanel>
                </>
              )}

              <Typography variant="body2" textAlign="center" color="text.secondary">
                {t("noAccount")}{" "}
                <Link href={`/auth/signup?callbackURL=${encodeURIComponent(callbackURL)}`} underline="hover">
                  {t("signUp")}
                </Link>
              </Typography>

              {/* ADR-0012 + #506: when the user lands on /auth/signin without a
                  callbackURL (no deep-link entry point, stale bookmark, etc.)
                  we silently redirect to /dashboard after signin. Many users
                  are landing here from the "main page" signin link and
                  expecting to go back to a specific event. Surface the
                  common destinations explicitly so they can pick. */}
              {!hasCallbackURL && (
                <Box
                  data-testid="post-login-fallback"
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 2,
                    p: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t("signInNoDestination")}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="text" href="/dashboard">
                      {t("dashboard")}
                    </Button>
                    <Button size="small" variant="text" href="/public">
                      {t("publicGames")}
                    </Button>
                  </Stack>
                </Box>
              )}
            </Stack>
          </Paper>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
