/* eslint-disable @eslint-react/purity -- React Compiler hint, not a bug. Date objects during render are common and necessary for time-based UI (countdown, past detection, etc.) */
/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
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
import { shareForHomeScreen } from "~/lib/pwaInstall";
import { SignInModal } from "./SignInModal";

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
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
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
  // eslint-disable-next-line @eslint-react/no-clone-element -- MUI idiom for forwarding elevation prop
  return React.cloneElement(children, { elevation: trigger ? 4 : 0 });
}

function UpdateBanner() {
  const { t } = useLocale();
  const theme = useTheme();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const registrations: Array<{ target: EventTarget; type: string; listener: EventListener }> = [];

    const add = (target: EventTarget, type: string, listener: EventListener) => {
      // eslint-disable-next-line @eslint-react/web-api-no-leaked-event-listener -- cleaned up via registrations array in the effect cleanup
      target.addEventListener(type, listener);
      registrations.push({ target, type, listener });
    };

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (cancelled) return;
      if (reg.waiting) { setWaiting(reg.waiting); return; }
      const onUpdateFound = () => {
        const newSW = reg.installing;
        if (!newSW) return;
        add(newSW, "statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(newSW);
          }
        });
      };
      add(reg, "updatefound", onUpdateFound);
    });
    // Reload once the new service worker takes control — the reliable signal
    // that the update has activated (covers browsers where the per-worker
    // statechange handler in handleUpdate doesn't fire as expected).
    let reloaded = false;
    add(navigator.serviceWorker, "controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    return () => {
      cancelled = true;
      for (const { target, type, listener } of registrations) {
        target.removeEventListener(type, listener);
      }
    };
  }, []);

  const [dismissed, setDismissed] = useState(false);

  if (!waiting || dismissed) return null;

  const handleUpdate = () => {
    waiting.postMessage("SKIP_WAITING");
    // The controllerchange listener (registered in the effect) reloads as soon
    // as the new worker takes control. This timeout is a last-resort fallback.
    // ponytail: 3s heuristic — if the SW never activates we reload anyway so
    // the user is never stuck on a stale build.
    setTimeout(() => window.location.reload(), 3000);
  };

  const versionText = typeof __APP_VERSION__ !== "undefined"
    ? t("versionAvailable").replace("{version}", __APP_VERSION__)
    : t("updateAvailable");

  // Bottom-anchored slim bar (shares the bottom slot with the install banner
  // and never overlaps the app bar). Sits just above the install banner if
  // both happen to show.
  return (
    <Slide in direction="up">
      <Paper elevation={6} sx={{
        position: "fixed",
        bottom: { xs: 0, sm: 16 },
        left: { xs: 0, sm: "50%" },
        right: { xs: 0, sm: "auto" },
        transform: { sm: "translateX(-50%)" },
        zIndex: theme.zIndex.snackbar + 1,
        display: "flex", alignItems: "center", gap: 1.5,
        px: 2, py: 1.25,
        borderRadius: { xs: "16px 16px 0 0", sm: 3 },
        maxWidth: "100%",
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
      }}>
        <SystemUpdateAltIcon fontSize="small" sx={{ flexShrink: 0 }} />
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>
          {versionText}
        </Typography>
        <Button size="small" variant="contained" onClick={handleUpdate} sx={{
          backgroundColor: theme.palette.primary.contrastText,
          color: theme.palette.primary.main,
          "&:hover": { backgroundColor: theme.palette.primary.contrastText, opacity: 0.9 },
          fontWeight: 700, flexShrink: 0,
        }}>
          {t("updateNow")}
        </Button>
        <IconButton
          size="small"
          onClick={() => setDismissed(true)}
          aria-label={t("installDismiss")}
          sx={{ color: theme.palette.primary.contrastText, flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Slide>
  );
}

function InstallBanner() {
  const { t } = useLocale();
  const theme = useTheme();
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIos, setShowIos] = useState(false);
  // #136: track the live Notification.permission so the copy can pitch the
  // *notification* win, not just the "quick access" win.
  const [permission, setPermission] = useState<"default" | "granted" | "denied" | "unsupported">("default");

  useEffect(() => {
    // Don't show if already installed or recently dismissed
    if (isStandalone() || isDismissed()) return;

    // Yield the bottom slot to the update banner when an app update is pending
    // — they share the same anchor and we never want both at once.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) setShowBanner(false);
      }).catch(() => {});
    }

    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }

    // iOS: show manual instructions
    if (isIos()) {
      setShowIos(true);
      return;
    }

    // #136: if push is already granted, the install banner has no value-prop
    // left to pitch — silently suppress.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      return;
    }

    // Chrome/Edge/etc: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Detect successful install
    const installHandler = () => {
      setShowBanner(false);
      deferredPromptRef.current = null;
    };
    window.addEventListener("appinstalled", installHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPromptRef.current) return;
    await deferredPromptRef.current.prompt();
    const { outcome } = await deferredPromptRef.current.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    deferredPromptRef.current = null;
  };

  const handleIosShare = async () => {
    // iOS has no programmatic A2HS; open the native share sheet, which holds
    // the "Add to Home Screen" action. Falls back to the on-screen hint when
    // the Web Share API is unavailable.
    await shareForHomeScreen(navigator, window.location.href, document.title);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIos(false);
    setDismissed();
  };

  if (!showBanner && !showIos) return null;

  // #136: permission-aware description copy.
  // - iOS + notif default: pitch the iOS-specific two-step flow.
  // - desktop + notif default: pitch the notification win.
  // - iOS + notif denied: keep the manual hint.
  // - desktop + notif denied: same as default (the install doesn't unblock
  //   the system permission, but the banner is still useful for app UX).
  const descKey = showIos && permission === "default"
    ? "installAppDescIos"
    : showIos
      ? "installIosHint"
      : permission === "default"
        ? "installAppDescNotifications"
        : "installAppDesc";

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
        <Box
          sx={{ flex: 1, minWidth: 0, cursor: showIos ? "pointer" : "default" }}
          onClick={showIos ? handleIosShare : undefined}
        >
          <Typography variant="body2" fontWeight={700}>
            {t("installApp")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t(descKey)}
          </Typography>
        </Box>
        {showIos ? (
          <IconButton
            size="small"
            onClick={handleIosShare}
            aria-label={t("installApp")}
            sx={{ color: theme.palette.primary.main, flexShrink: 0 }}
          >
            <IosShareIcon fontSize="small" />
          </IconButton>
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
  const { data: session, isPending: sessionLoading, refetch: refetchSession } = useSession();
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  // Where Google redirect should return to: the current page (so in-place
  // login on an event page lands back on that event).
  const signInCallbackURL = typeof window !== "undefined"
    ? (window.location.pathname === "/" ? "/dashboard" : window.location.pathname + window.location.search)
    : "/dashboard";

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
                  onClick={() => setSignInOpen(true)}
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

      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        callbackURL={signInCallbackURL}
        onSuccess={() => {
          setSignInOpen(false);
          // Revalidate the session so the signed-in UI swaps in without a
          // full-page navigation — the user stays on the current page.
          refetchSession?.();
        }}
      />

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
              sx={{ display: "flex", alignItems: "center", textDecoration: "none", "&:hover": { color: theme.palette.primary.main } }}
            >
              {t("docs")}
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ display: "flex", alignItems: "center" }}>·</Typography>
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
