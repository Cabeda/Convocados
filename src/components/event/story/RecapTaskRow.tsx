import type { ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { EASE } from "./Scoreboard";

export interface RecapTaskRowProps {
  title: string;
  sub?: string;
  /** Label of the pill action. Omit for a row that is information only. */
  action?: string;
  onAction?: () => void;
  href?: string;
  busy?: boolean;
  /** The row is finished: the amber dot becomes a check that draws itself. */
  done?: boolean;
  /** One soft pulse, for a deep link that scrolled here. */
  highlight?: boolean;
  /** Test id; defaults to recap-task / recap-task-done. */
  testId?: string;
  /** Extra content under the row (an inline picker, an error). */
  children?: ReactNode;
}

const pressable = {
  transition: "transform 80ms ease, opacity 80ms ease",
  "&:active": { transform: "scale(.98)", opacity: 0.85 },
  "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:active": { transform: "none" } },
};

/** The marker: an amber dot while something is left, a check that draws itself once it is done. */
function Marker({ done }: { done: boolean }) {
  if (!done) {
    return <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "warning.main", flex: "0 0 auto", mx: 0.75 }} />;
  }
  return (
    <Box component="svg" aria-hidden viewBox="0 0 24 24" sx={{ width: 22, height: 22, flex: "0 0 auto", color: "primary.main" }}>
      <Box
        component="path" d="M5 12.5l4.5 4.5L19 7.5"
        sx={{
          fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: 22,
          animation: `recapCheck 220ms ${EASE}`,
          "@keyframes recapCheck": { from: { strokeDashoffset: 22 }, to: { strokeDashoffset: 0 } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
    </Box>
  );
}

/** One thing left for the viewer: marker, what it is, and one pill action (at least 44px tall). */
export function RecapTaskRow({ title, sub, action, onAction, href, busy, done = false, highlight = false, testId, children }: RecapTaskRowProps) {
  const actionProps = href ? { component: "a", href } : { onClick: onAction };
  return (
    <Box
      data-testid={testId ?? (done ? "recap-task-done" : "recap-task")}
      sx={{
        borderTop: 1, borderColor: "divider",
        ...(highlight ? {
          animation: `recapPulse 1200ms ${EASE}`,
          "@keyframes recapPulse": { "0%,100%": { backgroundColor: "transparent" }, "35%": { backgroundColor: "action.selected" } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        } : {}),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 64, px: 2 }}>
        <Marker done={done} />
        <Box sx={{ flex: 1, minWidth: 0, py: 1 }}>
          <Typography sx={{ fontSize: "1.0625rem", lineHeight: 1.35, fontWeight: done ? 400 : 700, color: done ? "text.secondary" : "text.primary", textWrap: "balance" }}>{title}</Typography>
          {sub && <Typography sx={{ fontSize: "0.875rem", lineHeight: 1.4, color: "text.secondary", textWrap: "pretty" }}>{sub}</Typography>}
        </Box>
        {action && !done && (
          <Button
            variant="contained" disableElevation disabled={busy} {...actionProps}
            sx={{ minHeight: 44, minWidth: 44, px: 2.5, borderRadius: 999, fontSize: "1rem", fontWeight: 700, textTransform: "none", whiteSpace: "nowrap", ...pressable }}
          >
            {action}
          </Button>
        )}
      </Box>
      {children}
    </Box>
  );
}
