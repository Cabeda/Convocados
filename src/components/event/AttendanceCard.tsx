import React, { useEffect, useState } from "react";
import {
  Paper, Typography, Stack, Chip, Skeleton, useTheme,
} from "@mui/material";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useT } from "~/lib/useT";

interface Summary {
  yes: number;
  no: number;
  pending: number;
}

interface Props {
  eventId: string;
}

/** #457 Organizer-facing attendance card. Owner/Admin only (gated by the API too). */
export function AttendanceCard({ eventId }: Props) {
  const t = useT();
  const theme = useTheme();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/events/${eventId}/rsvp/summary`, { credentials: "include" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 403 || r.status === 404) {
          setError("forbidden");
          return;
        }
        if (!r.ok) {
          setError("error");
          return;
        }
        const data = await r.json();
        setSummary({ yes: data.yes, no: data.no, pending: data.pending });
      })
      .catch(() => alive && setError("error"));
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (error === "forbidden") return null;

  return (
    <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("attendanceCard")}
      </Typography>
      {error === "error" ? (
        <Typography variant="body2" color="text.secondary">—</Typography>
      ) : !summary ? (
        <Skeleton variant="rectangular" height={32} />
      ) : (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            icon={<HowToRegIcon />}
            label={`${summary.yes} ${t("rsvpYes")}`}
            color="success"
            variant="outlined"
          />
          <Chip
            icon={<CancelIcon />}
            label={`${summary.no} ${t("rsvpNo")}`}
            color="error"
            variant="outlined"
          />
          <Chip
            icon={<HelpOutlineIcon />}
            label={`${summary.pending} pending`}
            variant="outlined"
            sx={{ borderColor: theme.palette.divider }}
          />
        </Stack>
      )}
    </Paper>
  );
}
