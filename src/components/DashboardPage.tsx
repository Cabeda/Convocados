import React from "react";
import useSWR from "swr";
import {
  Container, Typography, Stack, Box, Button,
  CircularProgress, Alert, Divider,
} from "@mui/material";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { GameCard, type GameSummary } from "./GameCard";

interface DashboardData {
  owned: GameSummary[];
  joined: GameSummary[];
}

export default function DashboardPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();

  const { data, isLoading } = useSWR<DashboardData>(
    session?.user ? "/api/me/games" : null,
    (url: string) => fetch(url).then((r) => r.json()),
  );

  if (sessionLoading) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  if (!session?.user) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t("myGames")}
            </Typography>
            <Typography color="text.secondary" gutterBottom>
              {t("signIn")}
            </Typography>
            <Button variant="contained" href="/auth/signin" sx={{ mt: 2 }}>
              {t("signIn")}
            </Button>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Typography variant="h4" fontWeight={700}>{t("myGames")}</Typography>

            {isLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                {/* Owned games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("ownedGames")}
                  </Typography>
                  {data?.owned && data.owned.length > 0 ? (
                    <Stack spacing={1.5}>
                      {data.owned.map((g) => <GameCard key={g.id} game={g} />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noOwnedGames")}</Alert>
                  )}
                </Box>

                <Divider />

                {/* Joined games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("joinedGames")}
                  </Typography>
                  {data?.joined && data.joined.length > 0 ? (
                    <Stack spacing={1.5}>
                      {data.joined.map((g) => <GameCard key={g.id} game={g} />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noJoinedGames")}</Alert>
                  )}
                </Box>
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
