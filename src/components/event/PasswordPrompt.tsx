import React, { useState } from "react";
import {
  Container, Typography, TextField, Button, Box, Stack, CircularProgress,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
  title: string;
  onUnlocked: () => void;
}

export function PasswordPrompt({ eventId, title, onUnlocked }: Props) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/access/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onUnlocked();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ py: 8, textAlign: "center" }}>
      <Stack spacing={3} alignItems="center">
        <LockIcon sx={{ fontSize: 48, color: "text.secondary" }} />
        <Typography variant="h5" fontWeight={700}>{title}</Typography>
        <Typography color="text.secondary">{t("eventLocked")}</Typography>
        <Box component="form" onSubmit={handleSubmit} sx={{ width: "100%" }}>
          <Stack spacing={2}>
            <TextField
              type="password"
              label={t("enterPassword")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              autoFocus
              error={error}
              helperText={error ? t("incorrectPassword") : undefined}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !password}
              startIcon={loading ? <CircularProgress size={16} /> : <LockIcon />}
            >
              {t("unlockEvent")}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
}
