import React from "react";
import { Container, Typography, Button, Stack } from "@mui/material";

/**
 * 404 page for SPA routes the persistent shell can render.
 * Shown when the URL doesn't match any known page (and isn't a /docs/*
 * route, which has its own layout).
 */
export default function NotFoundPage() {
  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
      <Stack spacing={3} alignItems="center">
        <Typography variant="h2" fontWeight={800}>404</Typography>
        <Typography variant="h5" fontWeight={600}>Page not found</Typography>
        <Typography color="text.secondary">
          The page you are looking for does not exist.
        </Typography>
        <Button variant="contained" href="/">Back to home</Button>
      </Stack>
    </Container>
  );
}
