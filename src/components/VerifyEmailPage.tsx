import React, { useState, useEffect } from "react";
import {
  Container, Paper, Typography, Button, Stack, Alert, Link,
} from "@mui/material";
import MarkEmailReadOutlined from "@mui/icons-material/MarkEmailReadOutlined";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { authClient } from "~/lib/auth.client";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailPage() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email") ?? "";
  const callbackURL = params.get("callbackURL") || "/";
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      await authClient.sendVerificationEmail({ email });
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="xs" sx={{ py: 8 }}>
          <Paper elevation={2} sx={{ borderRadius: 3, p: 4 }}>
            <Stack spacing={3} alignItems="center">
              <MarkEmailReadOutlined sx={{ fontSize: 64, color: "primary.main" }} />
              <Typography variant="h5" fontWeight={700} textAlign="center">
                {t("checkYourEmail")}
              </Typography>
              <Typography variant="body1" textAlign="center" color="text.secondary">
                {t("checkYourEmailDesc", { email: email || "—" })}
              </Typography>

              {sent && <Alert severity="success">{t("verificationSent")}</Alert>}
              {error && <Alert severity="error">{error}</Alert>}

              <Button
                variant="outlined"
                onClick={handleResend}
                disabled={loading || cooldown > 0 || !email}
                fullWidth
              >
                {loading
                  ? t("resendingVerification")
                  : cooldown > 0
                    ? `${t("resendVerification")} (${cooldown}s)`
                    : t("resendVerification")}
              </Button>

              <Typography variant="body2" textAlign="center" color="text.secondary">
                <Link href={`/auth/signin?callbackURL=${encodeURIComponent(callbackURL)}`} underline="hover">
                  {t("signIn")}
                </Link>
              </Typography>
            </Stack>
          </Paper>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
