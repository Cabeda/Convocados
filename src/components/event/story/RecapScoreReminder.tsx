import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";
import type { RecapTask } from "~/lib/eventStory";
import type { Optimistic } from "./postGameStatus";
import { AddScoreSteppers } from "./AddScoreSteppers";
import { useOptimisticAction } from "./useOptimisticAction";
import { reminderSx } from "./RecapReminder";
import { ACTION_HEIGHT, EASE, tappable } from "./styles";

export interface RecapScoreReminderProps {
  eventId: string;
  teamOneName: string;
  teamTwoName: string;
  task: Extract<RecapTask, { kind: "addScore" }>;
  /** The history row the score is saved on; null when it cannot be saved in place (then the row links to History). */
  targetId: string | null;
  /** The score was saved this visit: the row says so instead of vanishing. */
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  /** Open the steppers straight away (the `?action=add-score` deep link). */
  autoOpen?: boolean;
  onOptimistic: (patch: Optimistic) => void;
  onRollback: (key: keyof Optimistic) => void;
  /** Re-read the status once the server has the score. */
  onChanged: () => void;
}

const CALM = "@media (prefers-reduced-motion: reduce)";

/**
 * Game day drops the recap, but a game with no score is not finished: this one row
 * stays (and nothing else of the recap) until someone adds it, in place.
 */
export function RecapScoreReminder(p: RecapScoreReminderProps) {
  const { t } = useLocale();
  const inline = p.task.inline && !!p.targetId;
  const [open, setOpen] = useState(!!p.autoOpen && inline);
  const [failed, setFailed] = useState<[number, number] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(false);
  const action = useOptimisticAction();
  const panelId = `recap-panel-score-${p.eventId}`;

  // The deep link brings the viewer to this row: scroll to it once.
  useEffect(() => {
    if (!p.autoOpen) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [p.autoOpen]);

  // Not now returns focus to the button that opened the steppers.
  useEffect(() => {
    if (!open && returnFocusRef.current) { returnFocusRef.current = false; triggerRef.current?.focus(); }
  }, [open]);

  // The button that saved is gone: the line saying so is where focus goes.
  useEffect(() => { if (p.saved) statusRef.current?.focus({ preventScroll: true }); }, [p.saved]);

  const save = (a: number, b: number) => {
    const target = p.targetId;
    if (!target) return;
    void action.run({
      apply: () => { p.onOptimistic({ score: [a, b] }); setFailed(null); setOpen(false); p.onSavedChange(true); },
      request: () => apiRequest("PATCH /api/events/{id}/history/{historyId}", { params: { id: p.eventId, historyId: target }, body: { scoreOne: a, scoreTwo: b } }),
      revert: () => { p.onRollback("score"); p.onSavedChange(false); setFailed([a, b]); setOpen(true); },
    }).then((ok) => { if (ok) p.onChanged(); });
  };

  return (
    <Box
      ref={rootRef} data-testid="recap-score-reminder"
      sx={{
        ...reminderSx,
        // Once it is saved there is nothing left to do: no amber bar.
        ...(p.saved ? { "&::before": { display: "none" } } : {}),
        ...(p.autoOpen ? {
          animation: `recapScorePulse 1200ms ${EASE}`,
          "@keyframes recapScorePulse": { "0%,100%": { opacity: 1 }, "35%": { opacity: 0.6 } },
          [CALM]: { animation: "none" },
        } : {}),
      }}
    >
      {p.saved ? (
        <Box ref={statusRef} role="status" tabIndex={-1} sx={{ flex: "1 1 10rem", minWidth: 0, outline: "none" }}>
          <Typography sx={{ fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.35 }}>{t("recapScoreSaved")}</Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ flex: "1 1 10rem", minWidth: 0 }}>
            <Typography sx={{ fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.35 }}>{t("recapAddScoreTitle")}</Typography>
            <Typography sx={{ fontSize: "0.875rem", color: "text.secondary", lineHeight: 1.4 }}>{t("recapAddScoreSub")}</Typography>
          </Box>
          <Button
            ref={triggerRef} variant={open ? "outlined" : "contained"} disableElevation
            {...(inline
              ? { onClick: () => { if (open) returnFocusRef.current = true; setFailed(null); setOpen(!open); }, "aria-expanded": open, "aria-controls": panelId }
              : { component: "a", href: `/events/${p.eventId}/history` })}
            sx={{ minHeight: ACTION_HEIGHT, minWidth: 44, px: 2.5, ml: "auto", borderRadius: 999, fontWeight: 700, textTransform: "none", whiteSpace: "nowrap", ...tappable }}
          >
            {t(inline ? "recapAddScoreAction" : "recapAddScoreOpenHistory")}
          </Button>
          {inline && open && (
            <Box sx={{ flex: "1 1 100%", pb: 1 }}>
              <AddScoreSteppers
                panelId={panelId} teamOneName={p.teamOneName} teamTwoName={p.teamTwoName}
                initial={failed ?? undefined} startError={!!failed} onSave={save}
                onCancel={() => { returnFocusRef.current = true; setFailed(null); setOpen(false); }}
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
