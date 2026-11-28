import { useId, useRef, useState } from "react";
import { Box, Button, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContactsIcon from "@mui/icons-material/Contacts";
import { useT } from "~/lib/useT";
import type { SuggestionPill } from "~/lib/suggestionPills";
import { normalizeForMatch } from "~/lib/stringMatch";
import { PlayerAvatar } from "../PlayerIdentity";
import { playerInputPasswordManagerProps } from "../PlayerAutocomplete";
import { controlBorder, tappable } from "./styles";
import { isEmailLike, type FriendInput, type FriendResult } from "./useFriendActions";

const POSITIONS = [["", "positionNone"], ["GK", "positionGk"], ["DEF", "positionDef"], ["MID", "positionMid"], ["FWD", "positionFwd"]] as const;
const COLLAPSED_PILLS = 8;

interface Props {
  /** "friend": add someone else. "self": a signed-out visitor adding just their own name. */
  variant?: "friend" | "self";
  /** The list is full: a new person goes on the bench. */
  full: boolean;
  positionsEnabled: boolean;
  suggestions: readonly SuggestionPill[];
  busy: boolean;
  onSubmit: (text: string, position?: string) => Promise<FriendResult | null>;
  /** An email nobody has registered, with the name the viewer gave for them. */
  onAddNamedEmail: (email: string, name: string, position?: string) => Promise<FriendResult | null>;
  onSubmitMany: (inputs: FriendInput[]) => Promise<{ added: number; stoppedAt: number | null; message: string; who: string } | null>;
  onLink: (text: string) => Promise<FriendResult | null>;
  onClose: () => void;
}

type Contacts = { select: (fields: ("name" | "email")[], options?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; email?: string[] }>> };
const contactsApi = (): Contacts | null => {
  const c = typeof navigator !== "undefined" ? (navigator as unknown as { contacts?: Contacts }).contacts : undefined;
  return c && typeof c.select === "function" ? c : null;
};

/** One line of a pasted list: an email, or a name. */
const toInput = (line: string): FriendInput => (isEmailLike(line) ? { email: line.trim() } : { name: line.trim() });

/**
 * "Add a friend": one field for a name or an email, the people they have played with before as chips,
 * and one primary action. An invite link and "add several" are quiet text actions underneath.
 * It stays open after an add so the next person is one tap away; the close button is the only way out.
 */
export function AddFriendPanel({ variant = "friend", full, positionsEnabled, suggestions, busy, onSubmit, onAddNamedEmail, onSubmitMany, onLink, onClose }: Props) {
  const t = useT();
  const id = useId();
  const [several, setSeveral] = useState(false);
  const [text, setText] = useState("");
  const [list, setList] = useState("");
  const [position, setPosition] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  // An email nobody has registered: who is it? Never the address as a name.
  const [namingEmail, setNamingEmail] = useState<string | null>(null);
  const [theirName, setTheirName] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const self = variant === "self";
  const contacts = self ? null : contactsApi();

  const refocus = () => setTimeout(() => fieldRef.current?.focus(), 0);
  const value = several ? list : text;
  // The chips follow what is typed (accents and case ignored); anything typed is still allowed as free text.
  const typed = normalizeForMatch(text);
  const matching = isEmailLike(text) ? [] : typed ? suggestions.filter((s) => normalizeForMatch(s.name).includes(typed)) : suggestions;
  const shown = showAll ? matching : matching.slice(0, COLLAPSED_PILLS);

  const addOne = async (raw: string) => {
    const out = await onSubmit(raw, position || undefined);
    if (!out) return;
    if (out.ok) {
      setText(""); setPosition(""); setError("");
      // One person, themselves: done. A friend's panel stays open for the next one.
      if (self) onClose(); else refocus();
    }
    else if (out.needsName) { setNamingEmail(out.needsName.email); setTheirName(""); setError(""); }
    else setError(out.message);
  };

  const addNamedEmail = async () => {
    if (!namingEmail || !theirName.trim()) return;
    const out = await onAddNamedEmail(namingEmail, theirName, position || undefined);
    if (!out) return;
    if (out.ok) { setNamingEmail(null); setTheirName(""); setText(""); setPosition(""); setError(""); refocus(); } else setError(out.message);
  };

  const addMany = async (inputs: FriendInput[]) => {
    const out = await onSubmitMany(inputs);
    if (!out) return;
    if (out.stoppedAt === null) { setList(""); setError(""); refocus(); return; }
    // Keep what is left in the box, starting with the one that failed.
    setList(inputs.slice(out.stoppedAt).map((i) => i.name ?? i.email ?? "").join("\n"));
    setError(out.message);
  };

  const submit = () => {
    if (namingEmail) { void addNamedEmail(); return; }
    if (!value.trim() || busy) return;
    if (several) void addMany(list.split("\n").map((l) => l.trim()).filter(Boolean).map(toInput));
    else void addOne(text);
  };

  const pickContacts = async () => {
    if (!contacts) return;
    try {
      const picked = await contacts.select(["name", "email"], { multiple: several });
      const inputs = picked
        .map((c) => ({ name: c.name?.[0]?.trim() || undefined, email: c.email?.[0]?.trim() || undefined }))
        .filter((c) => c.name || c.email);
      if (inputs.length === 0) return;
      if (!several && inputs.length === 1 && !inputs[0].email) { setText(inputs[0].name ?? ""); setError(""); refocus(); return; }
      await addMany(inputs);
    } catch { /* cancelled, or the browser said no: the typed way is still there */ }
  };

  const label = several ? t("ngAddSeveralLabel") : t(self ? "ngYourNameField" : "ngFriendField");
  const title = t(self ? "ngAddYourName" : "ngAddFriend");
  const naming = namingEmail !== null;
  const canSubmit = naming ? !!theirName.trim() : !!value.trim();
  return (
    <Box
      id={id} role="group" aria-label={title} data-testid="add-friend-panel"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (naming) { setNamingEmail(null); refocus(); } else onClose();
      }}
      sx={{ mt: 1.5, border: 1, borderColor: "divider", borderRadius: "12px", p: 2 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography component="h3" sx={{ fontSize: "1.125rem", fontWeight: 700 }}>{title}</Typography>
        <IconButton aria-label={t("ngCloseAria")} onClick={onClose} sx={{ width: 44, height: 44, mr: -1, color: "text.secondary", ...tappable }}><CloseIcon /></IconButton>
      </Box>

      {naming ? (
        <Box data-testid="name-the-email" sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: "1rem", overflowWrap: "anywhere", color: "text.secondary" }}>{namingEmail}</Typography>
          <TextField
            inputRef={fieldRef} autoFocus required fullWidth label={t("ngTheirName")} value={theirName} error={!!error} sx={{ mt: 1.5 }}
            onChange={(e) => { setTheirName(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            helperText={error || t("ngNameWhoSees", { email: namingEmail })}
            slotProps={{ htmlInput: { maxLength: 50, ...playerInputPasswordManagerProps }, formHelperText: error ? { role: "alert" } : undefined }}
          />
          <Button onClick={() => { setNamingEmail(null); setError(""); refocus(); }} sx={{ minHeight: 44, mb: 1, textTransform: "none", fontWeight: 700, color: "text.secondary", ...tappable }}>
            {t("ngChangeEmail")}
          </Button>
        </Box>
      ) : (
        <TextField
          inputRef={fieldRef} autoFocus fullWidth multiline={several} minRows={several ? 4 : undefined}
          label={label} placeholder={self ? label : undefined} value={value} error={!!error} sx={{ mt: 1.5 }}
          onChange={(e) => { (several ? setList : setText)(e.target.value); setError(""); setShowAll(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !several && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          onPaste={(e) => {
            // A pasted list becomes "add several" with the list in it.
            const pasted = e.clipboardData.getData("Text");
            if (!self && !several && pasted.includes("\n") && pasted.split("\n").filter((l) => l.trim()).length > 1) {
              e.preventDefault();
              setList(pasted.trim());
              setSeveral(true);
            }
          }}
          helperText={error || " "}
          slotProps={{
            htmlInput: { maxLength: several ? 2000 : 120, ...playerInputPasswordManagerProps },
            formHelperText: error ? { role: "alert" } : undefined,
          }}
        />
      )}

      {positionsEnabled && !several && (
        <TextField select size="small" label={t("positionLabel")} value={position} onChange={(e) => setPosition(e.target.value)} sx={{ minWidth: 140, mb: 1.5 }} slotProps={{ inputLabel: { shrink: true } }}>
          {POSITIONS.map(([v, key]) => <MenuItem key={v} value={v}>{t(key)}</MenuItem>)}
        </TextField>
      )}

      {!self && !several && !naming && shown.length > 0 && (
        <>
          <Typography sx={{ fontSize: "0.9375rem", color: "text.secondary", mb: 0.75 }}>{t("ngPlayedBefore")}</Typography>
          <Box data-testid="friend-chips" sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
            {shown.map((s, i) => (
              <Button
                key={s.userId ?? `name:${s.name}`} variant="outlined" disabled={busy} onClick={() => void addOne(s.name)}
                aria-label={s.name} aria-describedby={s.reason ? `${id}-why-${i}` : undefined}
                startIcon={s.image ? <PlayerAvatar userId={s.userId} name={s.name} image={s.image} size={20} clickable={false} /> : undefined}
                sx={{ minHeight: 44, borderRadius: 999, textTransform: "none", fontSize: "0.9375rem", px: 1.75, py: 0.5, borderColor: controlBorder, color: "text.primary", ...tappable }}
              >
                <Box component="span" sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                  <span>{s.name}</span>
                  {s.reason && <Box component="span" id={`${id}-why-${i}`} sx={{ fontSize: "0.75rem", color: "text.secondary", fontWeight: 400 }}>{s.reason}</Box>}
                </Box>
              </Button>
            ))}
            {matching.length > COLLAPSED_PILLS && (
              <Button onClick={() => setShowAll((v) => !v)} sx={{ minHeight: 44, borderRadius: 999, textTransform: "none", fontWeight: 700, color: "text.secondary", ...tappable }}>
                {showAll ? t("showFewerSuggestions") : t("showMoreSuggestions")}
              </Button>
            )}
          </Box>
        </>
      )}

      <Button
        variant="contained" fullWidth disableElevation disabled={!canSubmit || busy} onClick={submit}
        sx={{ minHeight: 56, borderRadius: 999, fontSize: "1.125rem", fontWeight: 700, textTransform: "none", ...tappable }}
      >
        {several ? t("ngAddAll") : self ? t("ngAddMe") : full ? t("ngAddToBench") : t("ngAddToGame")}
      </Button>
      {full && (
        <Typography sx={{ mt: 1, fontSize: "0.9375rem", color: "text.secondary", textWrap: "pretty" }}>{t("ngBenchExplain")}</Typography>
      )}

      {!naming && !self && (
        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 1 }}>
          {!several && (
            // Never disabled: an empty field answers with what to do, instead of looking dead.
            <Button
              disabled={busy} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}
              onClick={async () => {
                const out = await onLink(text);
                if (out && !out.ok) { setError(out.message); if (!text.trim()) fieldRef.current?.focus(); }
              }}
            >
              {t("ngInviteLinkInstead")}
            </Button>
          )}
          <Box sx={{ display: "flex", marginLeft: "auto" }}>
            {contacts && (
              <Button startIcon={<ContactsIcon />} onClick={() => void pickContacts()} disabled={busy} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, color: "text.secondary", ...tappable }}>
                {t("addFromContacts")}
              </Button>
            )}
            <Button
              onClick={() => { setSeveral((s) => !s); setError(""); refocus(); }}
              sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, color: "text.secondary", ...tappable }}
            >
              {several ? t("ngJustOne") : t("ngAddSeveral")}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
