import React, { useState, useEffect } from "react";
import {
  AppBar, Toolbar, IconButton, Typography, Box, useTheme,
  Tooltip, Container, useScrollTrigger, Paper, Button, Slide,
} from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import GitHubIcon from "@mui/icons-material/GitHub";
import SportsIcon from "@mui/icons-material/Sports";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import { useThemeMode } from "./ThemeModeProvider";
import { useT } from "~/lib/useT";

function ElevationScroll({ children }: { children: React.ReactElement<{ elevation?: number }> }) {
  const trigger = useScrollTrigger({ disableHysteresis: true, threshold: 0 });
  return React.cloneElement(children, { elevation: trigger ? 4 : 0 });
}

function UpdateBanner() {
  const t = useT();
  const theme = useTheme();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // Already waiting on load (e.g. hard refresh)
      if (reg.waiting) { setWaiting(reg.waiting); return; }
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(newSW);
          }
        });
      });
    });
  }, []);

  if (!waiting) return null;

  const handleUpdate = () => {
    waiting.postMessage("SKIP_WAITING");
    waiting.addEventListener("statechange", () => {
      if (waiting.state === "activated") window.location.reload();
    });
  };

  return (
    <Slide in direction="down">
      <Paper elevation={4} sx={{
        position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)",
        zIndex: theme.zIndex.snackbar,
        display: "flex", alignItems: "center", gap: 2,
        px: 3, py: 1.5, borderRadius: 3,
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        whiteSpace: "nowrap",
      }}>
        <SystemUpdateAltIcon fontSize="small" />
        <Typography variant="body2" fontWeight={600}>{t("updateAvailable")}</Typography>
        <Button size="small" variant="contained" onClick={handleUpdate} sx={{
          backgroundColor: theme.palette.primary.contrastText,
          color: theme.palette.primary.main,
          "&:hover": { backgroundColor: theme.palette.primary.contrastText, opacity: 0.9 },
          fontWeight: 700, ml: 1,
        }}>
          {t("updateNow")}
        </Button>
      </Paper>
    </Slide>
  );
}

export const ResponsiveLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === "dark";
  const t = useT();

  return (
    <Box sx={{
      display: "flex", flexDirection: "column", minHeight: "100vh",
      bgcolor: theme.palette.background.default,
      transition: theme.transitions.create("background-color"),
    }}>
      <UpdateBanner />
      <ElevationScroll>
        <AppBar position="sticky" color="default" sx={{
          borderBottom: `1px solid ${theme.palette.divider}`,
          backdropFilter: "blur(8px)",
          backgroundColor: isDark ? "rgba(30,30,30,0.85)" : "rgba(255,255,255,0.85)",
        }}>
          <Toolbar>
            <SportsIcon sx={{ mr: 1, color: theme.palette.primary.main }} />
            <Typography
              variant="h6"
              component="a"
              href="/"
              sx={{
                flexGrow: 1, fontWeight: 700, textDecoration: "none", color: "inherit",
                "&:hover": { color: theme.palette.primary.main },
              }}
            >
              {t("appName")}
            </Typography>
            <Tooltip title={t("toggleDarkMode")}>
              <IconButton onClick={toggleMode} color="inherit" aria-label={t("toggleDarkMode")}>
                {isDark ? <Brightness7Icon /> : <Brightness4Icon />}
              </IconButton>
            </Tooltip>
            <Tooltip title={t("viewOnGithub")}>
              <IconButton color="inherit" aria-label={t("viewOnGithub")}
                href="https://github.com/Cabeda/Convocados"
                target="_blank" rel="noopener noreferrer">
                <GitHubIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
      </ElevationScroll>

      <Box component="main" sx={{ flexGrow: 1, width: "100%", pb: 4 }}>
        {children}
      </Box>

      <Box component="footer" sx={{
        py: 3, px: 2, mt: "auto",
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.divider}`,
      }}>
        <Container maxWidth="sm">
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} {t("appName")}
          </Typography>
        </Container>
      </Box>
    </Box>
  );
};
