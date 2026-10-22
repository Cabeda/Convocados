import React from "react";
import { Container, Paper, Typography, Stack, Box, Button } from "@mui/material";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { SignInForm } from "./SignInForm";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { sanitizeCallbackUrl } from "~/lib/safeRedirect";
import { oauthAuthorizeResumePath } from "~/lib/oauthAuthorizeResume";

export default function SignInPage() {
  const t = useT();
  const { data: session, isPending } = useSession();

  const rawCallback = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("callbackURL")
    : null;

  // Only same-origin destinations survive: resolving against our own origin
  // rejects protocol-relative, backslash-normalized and foreign-absolute URLs.
  const callbackURL = sanitizeCallbackUrl(rawCallback);

  const hasCallbackURL = typeof window !== "undefined" && !!new URLSearchParams(window.location.search).get("callbackURL");

  // An OAuth authorization request (better-auth sends the user here with the
  // signed request) has to be handed back to the authorization endpoint after
  // sign-in. Falling through to the dashboard loses the request: no code is
  // ever issued and the client reports "Authentication failed".
  const oauthResume =
    typeof window !== "undefined" ? oauthAuthorizeResumePath(window.location.search) : null;

  if (typeof window !== "undefined" && !hasCallbackURL && !oauthResume) {
    // ADR-0012: missing callbackURL means the user landed on /auth/signin without
    // a deep-link entry point — they'll be redirected to /dashboard after signin.
    console.warn("[SignInPage] no callbackURL on /auth/signin — post-login destination will fall back to /dashboard");
  }

  // Compute the safe post-login destination
  const postLoginURL = oauthResume ?? (callbackURL === "/" ? "/dashboard" : callbackURL);

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
                  surface the common destinations explicitly so they can pick.
                  An OAuth request is a destination too — it is resumed, not
                  offered as a choice. */}
              {!hasCallbackURL && !oauthResume && (
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
