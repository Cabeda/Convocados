import { Stack, Typography, useTheme } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import { useT } from "~/lib/useT";

export const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Cabeda";
export const KO_FI_URL = "https://ko-fi.com/cabeda";

function linkSx(hoverColor: string) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 0.5,
    color: "inherit",
    textDecoration: "none",
    "&:hover": { color: hoverColor },
  };
}

export default function SupportLinks() {
  const t = useT();
  const theme = useTheme();
  const secondaryColor = theme.palette.text.secondary;
  const hoverColor = theme.palette.primary.main;
  const separatorSx = { display: "flex", alignItems: "center", color: theme.palette.text.disabled };

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ flexWrap: "wrap", rowGap: 0.5, justifyContent: "center", alignItems: "center", color: secondaryColor }}
    >
      <Typography variant="body2" sx={{ display: "flex", alignItems: "center", color: secondaryColor }}>
        {t("supportUs")}
      </Typography>
      <Typography variant="body2" sx={separatorSx}>·</Typography>
      <Typography
        variant="body2"
        component="a"
        href={GITHUB_SPONSORS_URL}
        target="_blank"
        rel="noopener noreferrer"
        sx={linkSx(hoverColor)}
      >
        <FavoriteIcon sx={{ fontSize: 16 }} />
        GitHub Sponsors
      </Typography>
      <Typography variant="body2" sx={separatorSx}>·</Typography>
      <Typography
        variant="body2"
        component="a"
        href={KO_FI_URL}
        target="_blank"
        rel="noopener noreferrer"
        sx={linkSx(hoverColor)}
      >
        <LocalCafeIcon sx={{ fontSize: 16 }} />
        Ko-fi
      </Typography>
    </Stack>
  );
}