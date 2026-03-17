import React, { useState, useEffect, useRef } from "react";
import {
  AppBar, Toolbar, IconButton, Typography, Box, useTheme,
  Tooltip, Container, useScrollTrigger, Paper, Button, Slide,
  Menu, MenuItem, ListItemText,
} from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import GitHubIcon from "@mui/icons-material/GitHub";
import SportsIcon from "@mui/icons-material/Sports";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PublicIcon from "@mui/icons-material/Public";
import TranslateIcon from "@mui/icons-material/Translate";
import { useThemeMode } from "./ThemeModeProvider";
import { useLocale } from "~/lib/useT";
import type { Locale } from "~/lib/i18n";

const LOCALE_OPTIONS: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
];

function ElevationScroll({ children }: { children: React.ReactElement<{ elevation?: number }> }) {
  const trigger = useScrollTrigger({ disableHysteresis: true, threshold: 0 });
  return React.cloneElement(children, { elevation: trigger ? 4 : 0 });
}

function UpdateBanner() {
  const { t } = useLocale();
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
  const { locale, setLocale, t } = useLocale();
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);

  const handleLangSelect = (code: Locale) => {
    setLangAnchor(null);
    if (code !== locale) {
      setLocale(code);
      window.location.reload();
    }
  };

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
            <Tooltip title={t("publicGames")}>
              <IconButton color="inherit" aria-label={t("publicGames")}
                href="/public"
                component="a">
                <PublicIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("docs")}>
              <IconButton color="inherit" aria-label={t("docs")}
                href="/docs"
                component="a">
                <MenuBookIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={LOCALE_OPTIONS.find((o) => o.code === locale)?.label ?? "Language"}>
              <IconButton onClick={(e) => setLangAnchor(e.currentTarget)} color="inherit" aria-label="Change language">
                <TranslateIcon />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={langAnchor}
              open={Boolean(langAnchor)}
              onClose={() => setLangAnchor(null)}
            >
              {LOCALE_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.code}
                  selected={opt.code === locale}
                  onClick={() => handleLangSelect(opt.code)}
                >
                  <ListItemText>{opt.label}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
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
