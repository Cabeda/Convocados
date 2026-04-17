import React from "react";
import {
  Box, Typography, Stack, useTheme, useMediaQuery, Chip,
} from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import PaymentsIcon from "@mui/icons-material/Payments";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import AlarmIcon from "@mui/icons-material/Alarm";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import CreateEventForm from "./CreateEventForm";
import { useT } from "~/lib/useT";

const FEATURES = [
  { icon: CasinoIcon, key: "landingFeatureTeams" },
  { icon: PaymentsIcon, key: "landingFeaturePayments" },
  { icon: EmojiEventsIcon, key: "landingFeatureRankings" },
  { icon: NotificationsActiveIcon, key: "landingFeatureNotifications" },
  { icon: AlarmIcon, key: "landingFeatureReminders" },
] as const;

function HeroContent() {
  const t = useT();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Box sx={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      py: isMobile ? 2 : 4,
      px: isMobile ? 2 : 4,
    }}>
      <Typography
        variant={isMobile ? "h5" : "h3"}
        component="h1"
        sx={{
          fontWeight: 800,
          lineHeight: 1.15,
          mb: 1,
          color: theme.palette.text.primary,
        }}
      >
        {t("landingHeadline")}
      </Typography>

      <Typography
        variant={isMobile ? "body2" : "h6"}
        sx={{
          color: theme.palette.text.secondary,
          fontWeight: 400,
          mb: isMobile ? 1.5 : 3,
          maxWidth: 420,
        }}
      >
        {t("landingSubtitle")}
      </Typography>

      {isMobile ? (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          {FEATURES.map(({ icon: Icon, key }) => (
            <Chip
              key={key}
              icon={<Icon sx={{ fontSize: 14 }} />}
              label={t(key as any)}
              size="small"
              variant="outlined"
              sx={{ borderColor: theme.palette.primary.main, color: theme.palette.text.secondary, fontSize: "0.7rem", height: 26 }}
            />
          ))}
        </Stack>
      ) : (
        <Stack spacing={1.5} sx={{ mb: 4 }}>
          {FEATURES.map(({ icon: Icon, key }) => (
            <Stack key={key} direction="row" spacing={1.5} alignItems="center">
              <Icon sx={{ color: theme.palette.primary.main, fontSize: 22 }} />
              <Typography variant="body1" color="text.secondary">
                {t(key as any)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      {!isMobile && (
        <Typography
          variant="caption"
          sx={{ color: theme.palette.text.disabled, letterSpacing: 0.5 }}
        >
          {t("landingOpenSource")}
        </Typography>
      )}
    </Box>
  );
}

export default function LandingPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Box sx={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: isMobile ? "stretch" : "center",
      justifyContent: "center",
      minHeight: isMobile ? undefined : "calc(100vh - 130px)",
      maxWidth: 1200,
      mx: "auto",
      width: "100%",
    }}>
      <Box sx={{
        flex: isMobile ? "none" : "0 0 42%",
      }}>
        <HeroContent />
      </Box>
      <Box sx={{
        flex: isMobile ? "none" : 1,
        minWidth: 0,
      }}>
        <CreateEventForm bare />
      </Box>
    </Box>
  );
}

export function LandingPageWithProviders() {
  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <LandingPage />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
