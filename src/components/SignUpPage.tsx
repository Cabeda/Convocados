import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Stack, Alert, Link,
} from "@mui/material";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { signUp } from "~/lib/auth.client";

export default function SignUpPage() {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        console.error("Sign-up error:", result.error);
        setError(result.error.message || t("authSignupError"));
      } else {
        window.location.href = "/";
      }
    } catch (err) {
      console.error("Sign-up exception:", err);
      setError(t("authSignupError"));
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
                {t("signUp")}
              </Typography>

              {error && <Alert severity="error">{error}</Alert>}

              <TextField
                label={t("name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                fullWidth
                autoComplete="name"
                autoFocus
                inputProps={{ maxLength: 50 }}
              />
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
                autoComplete="new-password"
                inputProps={{ minLength: 8 }}
              />
              <TextField
                label={t("confirmPassword")}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                fullWidth
                autoComplete="new-password"
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                fullWidth
              >
                {loading ? t("signingUp") : t("signUp")}
              </Button>

              <Typography variant="body2" textAlign="center" color="text.secondary">
                {t("hasAccount")}{" "}
                <Link href="/auth/signin" underline="hover">
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
