import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Box, Button, Link, Typography } from "@mui/material";
import { ACTION_HEIGHT, DEEP_LINK_MARGIN, EASE, focusRing, tappable } from "./styles";

export interface RecapTaskRowProps {
  title: string;
  sub?: string;
  /** Label of the pill action. Omit for a row that is information only. */
  action?: string;
  onAction?: () => void;
  href?: string;
  /** Turns the action into a toggle for `panel`: aria-expanded + aria-controls, and it stays mounted while open. */
  expanded?: boolean;
  panelId?: string;
  actionRef?: Ref<HTMLButtonElement>;
  /** The row is finished: the dot becomes a check that draws itself. */
  done?: boolean;
  /** Does the viewer have to act? Only those rows get the amber dot. Defaults to true for a row with an action. */
  needsYou?: boolean;
  /** Scroll this row into view and pulse it once (a deep link brought the viewer here). */
  highlight?: boolean;
  /** A quiet second way in, under the sentence ("How to pay"). */
  secondary?: { label: string; href: string };
  /** Test id; defaults to recap-task / recap-task-done. */
  testId?: string;
  /** What the toggle opens. */
  panel?: ReactNode;
  /** Extra content under the row (an error). */
  children?: ReactNode;
}

const CALM = "@media (prefers-reduced-motion: reduce)";

/** The marker: an amber dot when the viewer has to act, a quiet ring when it is only information, a check once done. */
function Marker({ done, needsYou }: { done: boolean; needsYou: boolean }) {
  if (done) {
    return (
      <Box component="svg" aria-hidden viewBox="0 0 24 24" sx={{ width: 22, height: 22, flex: "0 0 auto", color: "primary.main" }}>
        <Box
          component="path" d="M5 12.5l4.5 4.5L19 7.5"
          sx={{
            fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: 22,
            animation: `recapCheck 220ms ${EASE}`,
            "@keyframes recapCheck": { from: { strokeDashoffset: 22 }, to: { strokeDashoffset: 0 } },
            [CALM]: { animation: "none" },
          }}
        />
      </Box>
    );
  }
  if (needsYou) {
    // Amber fill with a darker ring: it reads as amber (not brown) and keeps 3:1 against the card in both themes.
    return (
      <Box
        aria-hidden data-testid="needs-you-dot"
        sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: "attention.main", border: "1.5px solid", borderColor: "attention.ring", flex: "0 0 auto", mx: 0.5 }}
      />
    );
  }
  return <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid", borderColor: "text.disabled", flex: "0 0 auto", mx: 0.75 }} />;
}

/**
 * One thing on the recap: marker, what it is, and one pill action (48px tall).
 * Below ~360px the action wraps under the sentence instead of crushing it.
 */
export function RecapTaskRow({
  title, sub, action, onAction, href, expanded, panelId, actionRef, done = false, needsYou, highlight = false, secondary, testId, panel, children,
}: RecapTaskRowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isToggle = expanded !== undefined;
  const dot = needsYou ?? !!action;
  const actionProps = href ? { component: "a", href } : { onClick: onAction };

  useEffect(() => {
    if (!highlight) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [highlight]);

  return (
    <Box
      ref={rootRef}
      data-testid={testId ?? (done ? "recap-task-done" : "recap-task")}
      sx={{
        borderTop: 1, borderColor: "divider", scrollMarginTop: DEEP_LINK_MARGIN,
        ...(highlight ? {
          animation: `recapPulse 1200ms ${EASE}`,
          "@keyframes recapPulse": { "0%,100%": { backgroundColor: "transparent" }, "35%": { backgroundColor: "action.selected" } },
          [CALM]: { animation: "none" },
        } : {}),
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5, minHeight: 64, px: 2, py: 0.5 }}>
        <Marker done={done} needsYou={dot} />
        <Box sx={{ flex: "1 1 10rem", minWidth: 0, py: 1 }}>
          <Typography sx={{ fontSize: "1.0625rem", lineHeight: 1.35, fontWeight: done ? 400 : 700, color: done ? "text.secondary" : "text.primary", textWrap: "balance" }}>{title}</Typography>
          {sub && <Typography sx={{ fontSize: "0.875rem", lineHeight: 1.4, color: "text.secondary", textWrap: "pretty" }}>{sub}</Typography>}
          {secondary && !done && (
            <Link
              href={secondary.href} underline="always"
              sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "0.9375rem", fontWeight: 700, borderRadius: 1, ...focusRing }}
            >
              {secondary.label}
            </Link>
          )}
        </Box>
        {action && !done && (
          <Button
            ref={actionRef} variant={isToggle && expanded ? "outlined" : "contained"} disableElevation {...actionProps}
            {...(isToggle ? { "aria-expanded": expanded, "aria-controls": panelId } : {})}
            sx={{ minHeight: ACTION_HEIGHT, minWidth: 44, px: 2.5, ml: "auto", borderRadius: 999, fontSize: "1rem", fontWeight: 700, textTransform: "none", whiteSpace: "nowrap", ...tappable }}
          >
            {action}
          </Button>
        )}
      </Box>
      {isToggle && expanded && panel}
      {children}
    </Box>
  );
}
