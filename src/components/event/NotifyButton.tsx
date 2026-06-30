import React, { useState, useEffect } from "react";
import {
  Button, Tooltip, Popover, Stack, Typography, Switch,
  FormControlLabel, Divider, ButtonGroup,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useT } from "~/lib/useT";

interface FollowState {
  following: boolean;
  mutePlayerActivity: boolean | null;
  muteReminders: boolean | null;
  mutePostGame: boolean | null;
  muteEventDetails: boolean | null;
}

interface Props {
  eventId: string;
  isAuthenticated: boolean;
}

export function NotifyButton({ eventId, isAuthenticated }: Props) {
  const t = useT();
  const [state, setState] = useState<FollowState>({ following: false, mutePlayerActivity: null, muteReminders: null, mutePostGame: null, muteEventDetails: null });
  const [pushDenied, setPushDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`/api/events/${eventId}/follow`).then(r => r.json()).then(d => setState(d)).catch(() => {});
    if ("Notification" in window && Notification.permission === "denied") setPushDenied(true);
  }, [eventId, isAuthenticated]);

  const handleFollow = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/follow`, { method: "POST" });
      const data = await res.json();
      setState(data);

      if ("serviceWorker" in navigator && "PushManager" in window && Notification.permission !== "denied") {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
          const keyRes = await fetch("/api/push/vapid-public-key");
          const { publicKey } = await keyRes.json();
          const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
          const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
          const raw = window.atob(base64);
          const key = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
          const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...sub.toJSON(), locale: navigator.language }),
          });
        } catch { /* push permission denied or unavailable */ }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async () => {
    setLoading(true);
    try {
      await fetch(`/api/events/${eventId}/follow`, { method: "DELETE" });
      setState({ following: false, mutePlayerActivity: null, muteReminders: null, mutePostGame: null, muteEventDetails: null });
      setAnchorEl(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleOverride = async (field: keyof FollowState) => {
    const current = state[field] as boolean | null;
    const newValue = current === true ? null : true; // toggle: muted → enabled (null), enabled → muted (true)
    setState(prev => ({ ...prev, [field]: newValue }));
    try {
      const res = await fetch(`/api/events/${eventId}/follow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, ...data }));
      }
    } catch { /* revert on error handled by next fetch */ }
  };

  // ADR 0017: Preset shortcuts
  const applyPreset = async (preset: "all" | "event_only") => {
    try {
      const res = await fetch(`/api/events/${eventId}/follow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, ...data }));
      }
    } catch { /* ignore */ }
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (state.following) {
      setAnchorEl(e.currentTarget);
    } else {
      handleFollow();
    }
  };

  if (!isAuthenticated) return null;

  if (pushDenied && !state.following) return (
    <Tooltip title={t("notifyDenied")}>
      <span>
        <Button variant="outlined" size="small" disabled startIcon={<NotificationsOffIcon />} sx={{ flexShrink: 0 }}>
          {t("notifyDenied")}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        color={state.following ? "success" : "inherit"}
        startIcon={state.following ? <NotificationsIcon /> : <NotificationsNoneIcon />}
        onClick={handleClick}
        disabled={loading}
        sx={{ flexShrink: 0 }}
      >
        {state.following ? t("notifyEnabled") : t("notifySubscribe")}
      </Button>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 260 } } }}
      >
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t("notificationSettingsForGame")}
        </Typography>
        <Stack spacing={0.5}>
          <FormControlLabel
            control={<Switch size="small" checked={state.mutePlayerActivity !== true} onChange={() => toggleOverride("mutePlayerActivity")} />}
            label={<Typography variant="body2">{t("playerActivity")}</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={state.muteReminders !== true} onChange={() => toggleOverride("muteReminders")} />}
            label={<Typography variant="body2">{t("gameReminders")}</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={state.mutePostGame !== true} onChange={() => toggleOverride("mutePostGame")} />}
            label={<Typography variant="body2">{t("postGameResults")}</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={state.muteEventDetails !== true} onChange={() => toggleOverride("muteEventDetails")} />}
            label={<Typography variant="body2">{t("eventDetails")}</Typography>}
          />
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <ButtonGroup size="small" fullWidth sx={{ mb: 1 }}>
          <Button onClick={() => applyPreset("all")} variant={state.mutePlayerActivity === false ? "contained" : "outlined"}>
            {t("notifyPresetAll")}
          </Button>
          <Button onClick={() => applyPreset("event_only")} variant={state.mutePlayerActivity === null && state.muteReminders === null ? "contained" : "outlined"}>
            {t("notifyPresetEventOnly")}
          </Button>
        </ButtonGroup>
        <Button size="small" color="error" onClick={handleUnfollow} disabled={loading} fullWidth>
          {t("notifyUnsubscribe")}
        </Button>
      </Popover>
    </>
  );
}
