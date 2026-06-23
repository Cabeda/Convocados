import React from "react";
import { Container, Paper, Typography, Stack, Box, Button } from "@mui/material";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { SignInForm } from "./SignInForm";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

export default function SignInPage() {
  const t = useT();
  const { data: session, isPending } = useSession();

  const rawCallback = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("callbackURL") || "/"
    : "/";

  // Sanitize callbackURL: only allow relative paths to prevent open redirects
  const callbackURL = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";

  const hasCallbackURL = typeof window !== "undefined" && !!new URLSearchParams(window.location.search).get("callbackURL");

  if (typeof window !== "undefined" && !hasCallbackURL) {
    // ADR-0012: missing callbackURL means the user landed on /auth/signin without
    // a deep-link entry point — they'll be redirected to /dashboard after signin.
    console.warn("[SignInPage] no callbackURL on /auth/signin — post-login destination will fall back to /dashboard");
  }

  // Compute the safe post-login destination
  const postLoginURL = callbackURL === "/" ? "/dashboard" : callbackURL;

  // Redirect already-authenticated users
  React.useEffect(() => {
    if (!isPending && session?.user) {
      window.location.href = postLoginURL;
    }
  }, [isPending, session, postLoginURL]);

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="xs" sx={{ py: 8 }}>
          <Paper elevation={2} sx={{ borderRadius: 3, p: 4 }}>
            <Stack spacing={3}>
              <Typography variant="h5" fontWeight={700} textAlign="center">
                {t("signIn")}
              </Typography>

              <SignInForm callbackURL={postLoginURL} />

              {/* ADR-0012 + #506: when the user lands on /auth/signin without a
                  callbackURL (no deep-link entry point, stale bookmark, etc.)
                  surface the common destinations explicitly so they can pick. */}
              {!hasCallbackURL && (
                <Box
                  data-testid="post-login-fallback"
                  sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}
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
