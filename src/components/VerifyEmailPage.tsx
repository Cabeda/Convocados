import React, { useState } from "react";
import {
  Container, Paper, Typography, Button, Stack, Alert,
} from "@mui/material";
import MarkEmailReadOutlined from "@mui/icons-material/MarkEmailReadOutlined";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { authClient } from "~/lib/auth.client";

export default function VerifyEmailPage() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email") ?? "";
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    try {
      await authClient.sendVerificationEmail({ email });
      setSent(true);
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
                {t("checkYourEmailDesc", { email })}
              </Typography>

              {sent && <Alert severity="success">{t("verificationSent")}</Alert>}
              {error && <Alert severity="error">{error}</Alert>}

              <Button
                variant="outlined"
                onClick={handleResend}
                disabled={loading || sent}
                fullWidth
              >
                {loading ? t("resendingVerification") : t("resendVerification")}
              </Button>
            </Stack>
          </Paper>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
