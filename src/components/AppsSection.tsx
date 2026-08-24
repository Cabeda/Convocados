import { Box, Button, Container, LinearProgress, Stack, Typography, useTheme, useMediaQuery } from "@mui/material";
import AndroidIcon from "@mui/icons-material/Android";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import { useT } from "~/lib/useT";
import { IOS_CAMPAIGN, campaignProgressPercent } from "~/lib/campaign";

const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.cabeda.Convocados";
const DOCS_URL = "/docs/mobile";

/**
 * "Apps for every team" — landing-page cards for the native mobile apps.
 * Android is available on Google Play; iOS is awaiting funding for the Apple
 * Developer Program membership. Create-a-game remains the page's primary
 * action; these cards are optional and outcome-driven.
 */
export default function AppsSection() {
  const t = useT();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const pct = campaignProgressPercent(IOS_CAMPAIGN.raisedUsd, IOS_CAMPAIGN.targetUsd);
  const progressLabel = t("iosFundProgress", {
    raised: IOS_CAMPAIGN.raisedUsd,
    target: IOS_CAMPAIGN.targetUsd,
  });

  return (
    <Box sx={{ width: "100%", py: 4, px: 2 }}>
      <Container maxWidth="lg">
        <Typography
          variant="h4"
          component="h2"
          sx={{ textAlign: "center", mb: 3, fontWeight: 700, color: theme.palette.text.primary }}
        >
          {t("appsForEveryTeamTitle")}
        </Typography>

        <Stack
          direction={isMobile ? "column" : "row"}
          spacing={3}
          sx={{ justifyContent: "center", alignItems: "stretch" }}
        >
          {/* Android Play Store card */}
          <Box sx={{
            flex: 1,
            maxWidth: 520,
            width: "100%",
            mx: "auto",
            p: 3,
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            display: "flex",
            flexDirection: "column",
          }}>
            <Typography variant="h6" component="h3" fontWeight={700}>
              {t("betaBannerTitle")}
            </Typography>
            <Typography sx={{ mt: 1, mb: 2, flex: 1 }} color="text.secondary">
              {t("betaBannerBody")}
            </Typography>
            <Button
              component="a"
              href={ANDROID_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              variant="contained"
              startIcon={<AndroidIcon />}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("landingBetaButton")}
            </Button>
          </Box>

          {/* iOS fundraising card */}
          <Box sx={{
            flex: 1,
            maxWidth: 520,
            width: "100%",
            mx: "auto",
            p: 3,
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            display: "flex",
            flexDirection: "column",
          }}>
            <Typography variant="h6" component="h3" fontWeight={700}>
              {t("iosFundHeading")}
            </Typography>

            <LinearProgress
              variant="determinate"
              value={pct}
              aria-label={progressLabel}
              sx={{ height: 10, borderRadius: 5, mt: 2 }}
            />
            <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
              {progressLabel}
            </Typography>

            <Typography sx={{ mt: 2, flex: 1 }} color="text.secondary">
              {t("iosFundBody")}
            </Typography>

            <Stack spacing={1} sx={{ mt: 2 }}>
              <Button
                component="a"
                href={IOS_CAMPAIGN.koFiGoalUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                startIcon={<PhoneIphoneIcon />}
                sx={{ alignSelf: "flex-start" }}
              >
                {t("iosFundCta")}
              </Button>
              <Typography
                variant="body2"
                component="a"
                href={IOS_CAMPAIGN.githubSponsorsUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: theme.palette.text.secondary, textDecoration: "underline" }}
              >
                {t("iosFundMonthly")}
              </Typography>
              <Typography
                variant="body2"
                component="a"
                href={DOCS_URL}
                sx={{ color: theme.palette.text.secondary, textDecoration: "underline" }}
              >
                {t("appsLearnMore")}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
