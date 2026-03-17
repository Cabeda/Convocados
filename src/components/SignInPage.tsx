import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack, Alert, Link,
} from "@mui/material";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { signIn } from "~/lib/auth.client";

export default function SignInPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(t("authError"));
      } else {
        window.location.href = "/";
      }
    } catch {
      setError(t("authError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="xs" sx={{ py: 8 }}>
          <Paper elevation={2} sx={{ borderRadius: 3, p: 4 }}>
            <Stack spacing={3} component="form" onSubmit={handleSubmit}>
              <Typography variant="h5" fontWeight={700} textAlign="center">
                {t("signIn")}
              </Typography>

              {error && <Alert severity="error">{error}</Alert>}

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

              <Typography variant="body2" textAlign="center" color="text.secondary">
                {t("noAccount")}{" "}
                <Link href="/auth/signup" underline="hover">
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
