import React, { useState, useEffect, useRef } from "react";
import {
  AppBar, Toolbar, IconButton, Typography, Box, useTheme,
  Tooltip, Container, useScrollTrigger, Paper, Button, Slide,
  Menu, MenuItem, ListItemText, ListItemIcon, Avatar, Divider,
  CircularProgress, Stack, Chip,
} from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import GitHubIcon from "@mui/icons-material/GitHub";
import SportsIcon from "@mui/icons-material/Sports";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import GetAppIcon from "@mui/icons-material/GetApp";
import IosShareIcon from "@mui/icons-material/IosShare";
import CloseIcon from "@mui/icons-material/Close";
import PublicIcon from "@mui/icons-material/Public";
import TranslateIcon from "@mui/icons-material/Translate";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PersonIcon from "@mui/icons-material/Person";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { useThemeMode } from "./ThemeModeProvider";
import { useLocale } from "~/lib/useT";
import type { Locale } from "~/lib/i18n";
import { useSession, signOut } from "~/lib/auth.client";

const LOCALE_OPTIONS: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

const INSTALL_DISMISS_KEY = "pwa-install-dismissed";
const INSTALL_DISMISS_DAYS = 7;

function isStandalone(): boolean {
  return typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const dismissed = parseInt(raw, 10);
    return Date.now() - dismissed < INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

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

  const versionText = typeof __APP_VERSION__ !== "undefined"
    ? t("versionAvailable").replace("{version}", __APP_VERSION__)
    : t("updateAvailable");

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
        <Typography variant="body2" fontWeight={600}>{versionText}</Typography>
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

function InstallBanner() {
  const { t } = useLocale();
  const theme = useTheme();
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    // Don't show if already installed or recently dismissed
    if (isStandalone() || isDismissed()) return;

    // iOS: show manual instructions
    if (isIos()) {
      setShowIos(true);
      return;
    }

    // Chrome/Edge/etc: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Detect successful install
    const installHandler = () => {
      setShowBanner(false);
      deferredPrompt.current = null;
    };
    window.addEventListener("appinstalled", installHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    deferredPrompt.current = null;
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIos(false);
    setDismissed();
  };

  if (!showBanner && !showIos) return null;

  return (
    <Slide in direction="up">
      <Paper elevation={6} sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: theme.zIndex.snackbar,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 3,
        py: 2,
        borderRadius: "16px 16px 0 0",
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.divider}`,
      }}>
        <GetAppIcon sx={{ color: theme.palette.primary.main, fontSize: 32 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700}>
            {t("installApp")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {showIos ? t("installIosHint") : t("installAppDesc")}
          </Typography>
        </Box>
        {showIos ? (
          <IosShareIcon sx={{ color: theme.palette.text.secondary, fontSize: 20, flexShrink: 0 }} />
        ) : (
          <Button
            size="small"
            variant="contained"
            onClick={handleInstall}
            sx={{ fontWeight: 700, flexShrink: 0 }}
          >
            {t("installBtn")}
          </Button>
        )}
        <IconButton
          size="small"
          onClick={handleDismiss}
          aria-label={t("installDismiss")}
          sx={{ flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Slide>
  );
}

export const ResponsiveLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === "dark";
  const { locale, setLocale, t } = useLocale();
  const [userAnchor, setUserAnchor] = useState<null | HTMLElement>(null);
  const [prefsAnchor, setPrefsAnchor] = useState<null | HTMLElement>(null);
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);
  const { data: session, isPending: sessionLoading } = useSession();
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    if (!session?.user) { setIsAdminUser(false); return; }
    fetch("/api/admin/check").then((r) => r.json()).then((d) => setIsAdminUser(d.isAdmin)).catch(() => {});
  }, [session?.user]);

  const handleLangSelect = (code: Locale) => {
    setLangAnchor(null);
    setUserAnchor(null);
    setPrefsAnchor(null);
    if (code !== locale) {
      setLocale(code);
      window.location.reload();
    }
  };

  const handleSignOut = async () => {
    setUserAnchor(null);
    await signOut();
    window.location.reload();
  };

  const currentLangLabel = LOCALE_OPTIONS.find((o) => o.code === locale)?.label ?? "Language";

  return (
    <Box sx={{
      display: "flex", flexDirection: "column", minHeight: "100vh",
      bgcolor: theme.palette.background.default,
      transition: theme.transitions.create("background-color"),
    }}>
      <UpdateBanner />
      <InstallBanner />
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
                display: "flex", alignItems: "center", gap: 0.5,
              }}
            >
              {t("appName")}
              <Chip label="beta" size="small" sx={{ fontSize: "0.6rem", height: 18, ml: 0.5 }} />
            </Typography>
            <Tooltip title={t("publicGames")}>
              <IconButton color="inherit" aria-label={t("publicGames")}
                href="/public"
                component="a">
                <PublicIcon />
              </IconButton>
            </Tooltip>

            {/* Auth: user menu (signed in) or preferences gear + sign-in (signed out) */}
            {sessionLoading ? (
              <CircularProgress size={20} sx={{ ml: 1 }} />
            ) : session?.user ? (
              <>
                {/* Signed in: avatar dropdown with profile, games, preferences, sign out */}
                <Tooltip title={session.user.name || session.user.email}>
                  <IconButton onClick={(e) => setUserAnchor(e.currentTarget)}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: "0.85rem", bgcolor: theme.palette.primary.main }}>
                      {(session.user.name || session.user.email || "?")[0].toUpperCase()}
                    </Avatar>
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={userAnchor}
                  open={Boolean(userAnchor)}
                  onClose={() => setUserAnchor(null)}
                >
                  <MenuItem disabled>
                    <ListItemText
                      primary={session.user.name}
                      secondary={session.user.email}
                    />
                  </MenuItem>
                  <Divider />
                  <MenuItem component="a" href={`/users/${session.user.id}`} onClick={() => setUserAnchor(null)}>
                    <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("editProfile")}</ListItemText>
                  </MenuItem>
                  <MenuItem component="a" href="/dashboard" onClick={() => setUserAnchor(null)}>
                    <ListItemIcon><DashboardIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("myGames")}</ListItemText>
                  </MenuItem>
                  {isAdminUser && (
                    <MenuItem component="a" href="/admin" onClick={() => setUserAnchor(null)}>
                      <ListItemIcon><AdminPanelSettingsIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{t("adminDashboard")}</ListItemText>
                    </MenuItem>
                  )}
                  <Divider />
                  <MenuItem onClick={(e) => setLangAnchor(e.currentTarget)}>
                    <ListItemIcon><TranslateIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{currentLangLabel}</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { toggleMode(); setUserAnchor(null); }}>
                    <ListItemIcon>
                      {isDark ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText>{t("toggleDarkMode")}</ListItemText>
                  </MenuItem>
                  <Divider />
                  <MenuItem onClick={handleSignOut}>
                    <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("signOut")}</ListItemText>
                  </MenuItem>
                </Menu>
              </>
            ) : (
              <>
                {/* Signed out: preferences gear + sign-in text button */}
                <Tooltip title={t("eventSettings")}>
                  <IconButton
                    color="inherit"
                    onClick={(e) => setPrefsAnchor(e.currentTarget)}
                    aria-label="Preferences"
                  >
                    <SettingsIcon />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={prefsAnchor}
                  open={Boolean(prefsAnchor)}
                  onClose={() => setPrefsAnchor(null)}
                >
                  <MenuItem onClick={(e) => setLangAnchor(e.currentTarget)}>
                    <ListItemIcon><TranslateIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{currentLangLabel}</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { toggleMode(); setPrefsAnchor(null); }}>
                    <ListItemIcon>
                      {isDark ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText>{t("toggleDarkMode")}</ListItemText>
                  </MenuItem>
                </Menu>
                <Button
                  color="inherit"
                  component="a"
                  href={`/auth/signin?callbackURL=${encodeURIComponent(window.location.pathname === "/" ? "/dashboard" : window.location.pathname + window.location.search)}`}
                  size="small"
                  sx={{ textTransform: "none", fontWeight: 600 }}
                >
                  {t("signIn")}
                </Button>
              </>
            )}

            {/* Shared language sub-menu */}
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
          <Stack direction="row" spacing={2} justifyContent="center" alignItems="center" sx={{ mb: 1 }}>
            <Typography
              variant="body2"
              component="a"
              href="/docs"
              color="text.secondary"
              sx={{ textDecoration: "none", "&:hover": { color: theme.palette.primary.main } }}
            >
              {t("docs")}
            </Typography>
            <Typography variant="body2" color="text.disabled">·</Typography>
            <Typography
              variant="body2"
              component="a"
              href="https://github.com/Cabeda/Convocados"
              target="_blank"
              rel="noopener noreferrer"
              color="text.secondary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, textDecoration: "none", "&:hover": { color: theme.palette.primary.main } }}
            >
              <GitHubIcon sx={{ fontSize: 16 }} />
              GitHub
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} {t("appName")}
          </Typography>
          <Typography variant="caption" color="text.disabled" align="center" component="div">
            <Typography
              component="a"
              href="https://github.com/Cabeda/Convocados/releases"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "inherit", textDecoration: "none", "&:hover": { color: theme.palette.primary.main } }}
            >
              v{__APP_VERSION__}
            </Typography>
          </Typography>
        </Container>
      </Box>
    </Box>
  );
};
