import { useEffect, useRef, useState, type RefObject } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useT } from "~/lib/useT";
import type { RsvpView } from "~/lib/nextGame";
import { SignInButton } from "../../SignInButton";
import { EASE, focusRing, tappable } from "./styles";

interface Props {
  view: RsvpView;
  /** The filled primary pill. False while the recap still has something for the viewer to do. */
  emphasis: boolean;
  busy: boolean;
  eventId: string;
  onSignedIn: () => void;
  onJoin: () => void;
  onDecline: () => void;
  /** Asks first (the dialog), then leaves. */
  onLeave: () => void;
  /** Scroll here and pulse once: a ?action=rsvp link brought the viewer. */
  highlight?: boolean;
  /** The row itself, so the page can put keyboard focus back on it once an answer has landed. */
  rowRef: RefObject<HTMLDivElement | null>;
}

const pill = {
  flex: 1, minHeight: 56, px: 3, borderRadius: 999, fontSize: "1.125rem", fontWeight: 700, textTransform: "none", whiteSpace: "nowrap",
  ...tappable,
  // Press feedback and the 200ms colour change when the recap's last task is done.
  transition: `transform 80ms ease, opacity 80ms ease, background-color 200ms ${EASE}, color 200ms ${EASE}, border-color 200ms ${EASE}`,
  "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:active": { transform: "none" } },
} as const;

/** The pill for a choice between two: wraps its own words and drops under the other when two will not fit. */
const choosePill = { ...pill, flex: "1 1 9rem", px: 2, whiteSpace: "normal", lineHeight: 1.2, py: 0.75, textWrap: "balance" } as const;

const quiet = { minHeight: 44, px: 1.5, textTransform: "none", fontWeight: 700, fontSize: "1rem", color: "text.secondary", borderRadius: 999, ...tappable } as const;

/** The RSVP row: one question, or one answer with a way to change it. */
export function RsvpRow({ view, emphasis, busy, eventId, onSignedIn, onJoin, onDecline, onLeave, highlight = false, rowRef }: Props) {
  const t = useT();
  // The panel belongs to the answer it was opened on: a new answer closes it.
  const [openFor, setOpenFor] = useState<RsvpView["kind"] | null>(null);
  const changing = openFor === view.kind;
  const setChanging = (open: boolean | ((was: boolean) => boolean)) =>
    setOpenFor((was) => ((typeof open === "function" ? open(was === view.kind) : open) ? view.kind : null));
  const changeRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const variant = emphasis ? "contained" : "outlined";

  // Opening the change panel moves focus into it; closing it puts focus back on "Change".
  const wasChangingRef = useRef(false);
  useEffect(() => {
    if (changing) firstRef.current?.focus();
    else if (wasChangingRef.current) changeRef.current?.focus();
    wasChangingRef.current = changing;
  }, [changing]);

  useEffect(() => {
    if (!highlight) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rowRef.current?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [highlight, rowRef]);

  let body;
  if (view.kind === "signIn") {
    body = (
      <SignInButton variant={variant} color="primary" fullWidth disableElevation callbackURL={`/events/${eventId}`} onSuccess={onSignedIn} sx={pill}>
        {t("ngSignIn")}
      </SignInButton>
    );
  } else if (view.kind === "choose") {
    // The two answers sit side by side while there is room; a long word in another language stacks them instead of overflowing.
    body = (
      <>
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
          <Button variant={variant} color="primary" disableElevation disabled={busy} onClick={onJoin} sx={choosePill}>
            {view.full ? t("ngJoinBench") : t("ngImIn")}
          </Button>
          <Button disabled={busy} onClick={onDecline} sx={{ ...choosePill, color: "text.secondary" }}>{t("ngCantMakeIt")}</Button>
        </Stack>
        {view.full && (
          <Typography data-testid="full-helper" sx={{ mt: 1, fontSize: "0.9375rem", lineHeight: 1.45, color: "text.secondary", textWrap: "pretty" }}>{t("ngFullHelper")}</Typography>
        )}
      </>
    );
  } else {
    const text = view.kind === "in"
      ? (view.team ? t("ngYoureInTeam", { team: view.team }) : t("ngYoureIn"))
      : view.kind === "bench" ? t("ngYoureOnBench", { n: view.position }) : t("ngYoureOut");
    const panelId = "rsvp-change-panel";
    body = (
      <>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", minHeight: 56, columnGap: 1 }}>
          <Typography data-testid="rsvp-status" sx={{ fontSize: "1.1875rem", lineHeight: 1.3, fontWeight: 700, color: view.kind === "out" ? "text.secondary" : "text.primary", textWrap: "balance" }}>{text}</Typography>
          <Button ref={changeRef} aria-expanded={changing} aria-controls={panelId} disabled={busy} onClick={() => setChanging((c) => !c)} sx={{ ...quiet, flexShrink: 0, color: "primary.main" }}>
            {t("ngChange")}
          </Button>
        </Stack>
        {changing && (
          <Stack id={panelId} direction="row" spacing={1.5} sx={{ alignItems: "center", pb: 0.5 }}>
            {view.kind === "out" ? (
              <>
                <Button ref={firstRef} variant="contained" disableElevation disabled={busy} onClick={onJoin} sx={pill}>{t("ngImIn")}</Button>
                <Button onClick={() => setChanging(false)} sx={{ ...pill, color: "text.secondary" }}>{t("ngStayOut")}</Button>
              </>
            ) : (
              <>
                <Button ref={firstRef} variant="outlined" disableElevation disabled={busy} onClick={onLeave} sx={pill}>{t("ngCantMakeIt")}</Button>
                <Button onClick={() => setChanging(false)} sx={{ ...pill, color: "text.secondary" }}>{t("ngKeepSpot")}</Button>
              </>
            )}
          </Stack>
        )}
      </>
    );
  }

  return (
    <Box
      ref={rowRef}
      tabIndex={-1} data-testid="rsvp-row"
      sx={{
        mt: 2, outline: "none", borderRadius: 2, ...focusRing,
        ...(highlight ? {
          animation: `ngRsvpPulse 1200ms ${EASE}`,
          "@keyframes ngRsvpPulse": { "0%,100%": { backgroundColor: "transparent" }, "35%": { backgroundColor: "action.selected" } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        } : {}),
      }}
    >
      {body}
    </Box>
  );
}
