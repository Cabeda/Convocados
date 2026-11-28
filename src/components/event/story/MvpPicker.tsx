import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, FormControlLabel, Radio, RadioGroup, TextField, Typography } from "@mui/material";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";
import { ACTION_HEIGHT, PANEL_ACTION_HEIGHT, tappable } from "./styles";

export interface MvpCandidate { id: string; name: string }

export interface MvpPickerProps {
  eventId: string;
  historyId: string;
  /** Id the Vote toggle points at (aria-controls). */
  panelId: string;
  /** The viewer: nobody votes for themselves. */
  selfName: string | null;
  /** Names the viewer is also known by (a linked roster name). */
  selfNames?: readonly string[];
  /** Start with this person picked (the viewer's own, after a vote the server refused). */
  initialPick?: string;
  /** Show the "couldn't save" line straight away. */
  startError?: boolean;
  /** The viewer taps Confirm. The parent saves it and shows the result at once. */
  onVote: (candidate: MvpCandidate) => void;
  /** The viewer taps Not now. */
  onCancel: () => void;
}

/** A short list shows everybody; a long one shows this many, plus a search that reaches all. */
const SHOWN = 5;
const LIST_MAX_HEIGHT = "17rem";

/**
 * Vote for MVP in place: one big row per player (five, then "Show all"), a search
 * that filters everyone, a list that scrolls instead of growing the card, and a
 * Confirm that stays in sight with a plain Not now beside it.
 */
export function MvpPicker({ eventId, historyId, panelId, selfName, selfNames, initialPick, startError, onVote, onCancel }: MvpPickerProps) {
  const t = useT();
  const [people, setPeople] = useState<MvpCandidate[] | null>(null);
  const [pick, setPick] = useState(initialPick ?? "");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const mine = useMemo(() => [selfName, ...(selfNames ?? [])].map((n) => (n ?? "").trim().toLowerCase()).filter(Boolean), [selfName, selfNames]);

  useEffect(() => {
    let live = true;
    apiRequest("GET /api/events/{id}/history/{historyId}/mvp", { params: { id: eventId, historyId } })
      .then((data) => {
        const list = ((data as { participants?: MvpCandidate[] }).participants ?? []);
        if (live) setPeople(list.filter((p) => !mine.includes(p.name.trim().toLowerCase())));
      })
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [eventId, historyId, mine]);

  // Once the list is there, the first player is where the keyboard goes.
  useEffect(() => {
    if (!people || focusedRef.current) return;
    focusedRef.current = true;
    listRef.current?.querySelector<HTMLInputElement>("input[type='radio']")?.focus();
  }, [people]);

  const searching = query.trim() !== "";
  const shown = useMemo(() => {
    const all = people ?? [];
    if (searching) return all.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (showAll) return all;
    const first = all.slice(0, SHOWN);
    // Somebody found through the search stays on the list after the search is cleared.
    const picked = all.find((p) => p.id === pick);
    return picked && !first.includes(picked) ? [...first, picked] : first;
  }, [people, query, searching, showAll, pick]);

  if (!people) return null;
  const chosen = people.find((p) => p.id === pick);
  // A pick that the search or the short list has scrolled out of view is still the pick.
  const hidden = people.length - shown.length;

  return (
    <Box id={panelId} role="group" aria-label={t("recapMvpTitle")} sx={{ px: 2, pb: 2 }}>
      {people.length > SHOWN && (
        <TextField
          fullWidth size="small" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("recapMvpSearch")} slotProps={{ htmlInput: { "aria-label": t("recapMvpSearch"), enterKeyHint: "search" } }}
          sx={{ mb: 1, "& .MuiInputBase-root": { minHeight: 48, borderRadius: 3 } }}
        />
      )}
      <Box ref={listRef} sx={{ maxHeight: LIST_MAX_HEIGHT, overflowY: "auto", overscrollBehavior: "contain" }}>
        <RadioGroup aria-label={t("recapMvpCandidates")} value={pick} onChange={(e) => setPick(e.target.value)}>
          {shown.map((p) => (
            <FormControlLabel
              key={p.id} value={p.id} label={p.name}
              control={<Radio />}
              sx={{
                m: 0, minHeight: 52, borderTop: 1, borderColor: "divider", "&:first-of-type": { borderTop: 0 },
                "&:has(:focus-visible)": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
                "& .MuiFormControlLabel-label": { fontSize: "1.0625rem", fontWeight: pick === p.id ? 700 : 400, overflowWrap: "anywhere" },
              }}
            />
          ))}
        </RadioGroup>
      </Box>
      {!searching && !showAll && hidden > 0 && (
        <Button onClick={() => setShowAll(true)} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}>
          {t("recapMvpShowAll", { n: people.length })}
        </Button>
      )}
      {startError && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.9375rem", py: 0.5 }}>{t("recapMvpError")}</Typography>}
      <Box
        sx={{
          position: "sticky", bottom: "env(safe-area-inset-bottom, 0px)", display: "flex", gap: 1, alignItems: "center",
          bgcolor: "background.paper", pt: 1, mt: 0.5, zIndex: 1,
        }}
      >
        <Button
          variant="contained" disableElevation disabled={!chosen} onClick={() => chosen && onVote(chosen)}
          sx={{ flex: 1, minHeight: PANEL_ACTION_HEIGHT, borderRadius: 999, fontSize: "1.0625rem", fontWeight: 700, textTransform: "none", ...tappable }}
        >
          {t("recapMvpConfirm")}
        </Button>
        <Button onClick={onCancel} sx={{ minHeight: ACTION_HEIGHT, minWidth: 44, borderRadius: 999, px: 2, fontWeight: 700, textTransform: "none", ...tappable }}>
          {t("recapNotNow")}
        </Button>
      </Box>
    </Box>
  );
}
