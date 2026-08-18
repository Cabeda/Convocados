import { Stack, Typography, useTheme, type SxProps, type Theme } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import { useT } from "~/lib/useT";

export const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Cabeda";
export const KO_FI_URL = "https://ko-fi.com/cabeda";

function linkSx(hoverColor: string): SxProps<Theme> {
  return {
    display: "flex",
    alignItems: "center",
    gap: 0.5,
    textDecoration: "none",
    "&:hover": { color: hoverColor },
  };
}

export default function SupportLinks() {
  const t = useT();
  const theme = useTheme();
  const hoverColor = theme.palette.primary.main;

  return (
    <Stack direction="row" spacing={2} justifyContent="center" alignItems="center">
      <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center" }}>
        {t("supportUs")}
      </Typography>
      <Typography
        variant="body2"
        component="a"
        href={GITHUB_SPONSORS_URL}
        target="_blank"
        rel="noopener noreferrer"
        color="text.secondary"
        sx={linkSx(hoverColor)}
      >
        <FavoriteIcon sx={{ fontSize: 16 }} />
        GitHub Sponsors
      </Typography>
      <Typography
        variant="body2"
        component="a"
        href={KO_FI_URL}
        target="_blank"
        rel="noopener noreferrer"
        color="text.secondary"
        sx={linkSx(hoverColor)}
      >
        <LocalCafeIcon sx={{ fontSize: 16 }} />
        Ko-fi
      </Typography>
    </Stack>
  );
}
