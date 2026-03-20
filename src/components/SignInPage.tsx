import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack, Alert, Link, Divider, Tabs, Tab, Box,
} from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import EmailIcon from "@mui/icons-material/Email";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { signIn } from "~/lib/auth.client";

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box>{children}</Box> : null;
}

export default function SignInPage() {
  const t = useT();
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const callbackURL = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("callbackURL") || "/"
    : "/";

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

              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<GoogleIcon />}
                onClick={handleGoogleSignIn}
                type="button"
              >
                {t("signInWithGoogle")}
              </Button>

              <Divider>{t("or")}</Divider>

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

              {/* Magic link tab */}
              <TabPanel value={tab} index={0}>
                <Stack spacing={3} component="form" onSubmit={handleMagicLinkSubmit}>
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
                <Stack spacing={3} component="form" onSubmit={handlePasswordSubmit}>
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

              <Typography variant="body2" textAlign="center" color="text.secondary">
                {t("noAccount")}{" "}
                <Link href={`/auth/signup?callbackURL=${encodeURIComponent(callbackURL)}`} underline="hover">
                  {t("signUp")}
                </Link>
              </Typography>
            </Stack>
          </Paper>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
