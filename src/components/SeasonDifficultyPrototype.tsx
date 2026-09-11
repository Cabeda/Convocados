/**
 * PROTOTYPE — throwaway. Not production code, no tests, no i18n.
 *
 * Question: "How do we show that one event is harder than another?"
 *
 * Three structurally different answers, switchable via `?variant=` on the
 * existing season page. All numbers are MOCKED — no Event Strength Index exists
 * in the API yet. Strength = imagined aggregate of members' global skill.
 */
import { useState } from "react";
import {
  Box, Chip, Divider, Paper, Stack, Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import type { PrototypeVariant } from "./PrototypeVariantSwitcher";

export interface EventDifficulty {
  id: string;
  name: string;
  /** Mocked Event Strength Index (~ members' global skill). */
  strength: number;
  players: number;
  masterEdge: number;
  isCurrent?: boolean;
}

const MOCK_EVENTS: EventDifficulty[] = [
  { id: "tue", name: "Tuesday League", strength: 1210, players: 48, masterEdge: 210 },
  { id: "cur", name: "Ninjas da Areosa — Q2 2026", strength: 1042, players: 12, masterEdge: 127, isCurrent: true },
  { id: "beach", name: "Beach Padel", strength: 960, players: 16, masterEdge: 110 },
  { id: "sun", name: "Sunday Casual", strength: 880, players: 22, masterEdge: 95 },
];

function starsFor(strength: number): number {
  if (strength >= 1180) return 5;
  if (strength >= 1040) return 4;
  if (strength >= 960) return 3;
  if (strength >= 880) return 2;
  return 1;
}
function divisionFor(strength: number): string {
  return `D${6 - starsFor(strength)}`;
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <Box sx={{ display: "inline-flex", color: "warning.main", lineHeight: 0 }}>
      {Array.from({ length: 5 }, (_, i) =>
        i < value ? <StarIcon key={i} sx={{ fontSize: size }} /> : <StarBorderIcon key={i} sx={{ fontSize: size, opacity: 0.45 }} />,
      )}
    </Box>
  );
}

const currentEvent: EventDifficulty = MOCK_EVENTS.find((e) => e.isCurrent) ?? MOCK_EVENTS[0];
const ranked = [...MOCK_EVENTS].sort((a, b) => b.strength - a.strength);

// ── Variant A: compact inline header badge ───────────────────────────────────
export function VariantA() {
  const e = currentEvent;
  const rank = ranked.findIndex((x) => x.id === e.id) + 1;
  const stronger = ranked.filter((x) => x.strength > e.strength).length;
  const weaker = ranked.length - rank;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Tooltip title={`Event Strength ${e.strength} — aggregate skill of this event's ranked players`}>
        <Chip
          icon={<EmojiEventsIcon />}
          label={`${divisionFor(e.strength)} · ${e.strength}`}
          sx={{ fontWeight: 800, bgcolor: (t) => alpha(t.palette.warning.main, 0.16), color: "warning.dark" }}
        />
      </Tooltip>
      <Stars value={starsFor(e.strength)} />
      <Typography variant="caption" color="text.secondary">
        {rank} of {ranked.length} of your events · harder than {weaker}, easier than {stronger}
      </Typography>
    </Stack>
  );
}

// ── Variant B: ranked comparison list ────────────────────────────────────────
export function VariantB() {
  const theme = useTheme();
  const e = currentEvent;
  const max = Math.max(...ranked.map((x) => x.strength));
  const min = Math.min(...ranked.map((x) => x.strength));
  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: 2 }}>
      <Typography variant="h6" fontWeight={700}>How this event stacks up</Typography>
      <Typography variant="caption" color="text.secondary">
        Event Strength across the events you play. Higher = tougher room.
      </Typography>
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {ranked.map((x, i) => {
          const pct = Math.round(((x.strength - min) / Math.max(1, max - min)) * 80) + 20;
          return (
            <Box
              key={x.id}
              sx={{
                p: 1, borderRadius: 2,
                border: x.isCurrent ? `1px solid ${theme.palette.warning.main}` : "1px solid transparent",
                bgcolor: x.isCurrent ? alpha(theme.palette.warning.main, 0.08) : undefined,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ width: 18, color: "text.secondary" }}>{i + 1}</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" fontWeight={x.isCurrent ? 800 : 500} noWrap>{x.name}</Typography>
                    {x.isCurrent && <Chip label="You're here" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />}
                  </Stack>
                  <Box sx={{ mt: 0.5, height: 8, borderRadius: 4, bgcolor: alpha(theme.palette.text.primary, 0.08), position: "relative" }}>
                    <Box sx={{ position: "absolute", inset: 0, width: `${pct}%`, borderRadius: 4, bgcolor: alpha(theme.palette.warning.main, x.isCurrent ? 0.9 : 0.4) }} />
                  </Box>
                </Box>
                <Stars value={starsFor(x.strength)} size={14} />
                <Chip label={divisionFor(x.strength)} size="small" variant="outlined" sx={{ fontWeight: 700 }} />
                <Typography variant="body2" fontWeight={700} sx={{ width: 44, textAlign: "right" }}>{x.strength}</Typography>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="caption" color="text.secondary">
        Master here needs strength {e.masterEdge}; Master in Tuesday League needs {ranked[0].masterEdge}. Same badge, higher bar.
      </Typography>
    </Paper>
  );
}

// ── Variant C: difficulty axis + tier equivalence ────────────────────────────
export function VariantC() {
  const theme = useTheme();
  const e = currentEvent;
  const [otherId, setOtherId] = useState(ranked[0].id);
  const other = MOCK_EVENTS.find((x) => x.id === otherId) ?? ranked[0];
  const lo = Math.min(...MOCK_EVENTS.map((x) => x.strength)) - 60;
  const hi = Math.max(...MOCK_EVENTS.map((x) => x.strength)) + 60;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const diff = other.strength - e.strength;
  const harsher = diff > 0;

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: 2 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Difficulty ladder</Typography>
          <Typography variant="caption" color="text.secondary">Where this event sits on the skill axis.</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary">Compare with</Typography>
          <Select size="small" value={otherId} onChange={(ev) => setOtherId(ev.target.value)} sx={{ minWidth: 180 }}>
            {ranked.filter((x) => !x.isCurrent).map((x) => (
              <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>
            ))}
          </Select>
        </Stack>
      </Stack>

      {/* Axis */}
      <Box sx={{ position: "relative", height: 120, mt: 3, mx: 1 }}>
        <Box sx={{ position: "absolute", top: 58, left: 0, right: 0, height: 4, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.12) }} />
        {MOCK_EVENTS.map((x) => (
          <Box key={x.id} sx={{ position: "absolute", left: pos(x.strength), transform: "translateX(-50%)", top: 0, textAlign: "center", width: 130 }}>
            <Typography variant="caption" fontWeight={x.isCurrent ? 800 : 500} noWrap sx={{ display: "block" }}>
              {x.isCurrent ? "This event" : x.name}
            </Typography>
            <Stars value={starsFor(x.strength)} size={12} />
            <Box sx={{ mt: 0.5, mx: "auto", width: 2, height: 26, bgcolor: alpha(theme.palette.text.primary, 0.3) }} />
            <Box sx={{ mx: "auto", width: 12, height: 12, borderRadius: "50%", mt: "-7px", bgcolor: x.isCurrent ? "warning.main" : theme.palette.text.disabled, border: "2px solid", borderColor: "background.paper" }} />
            <Typography variant="caption" color="text.secondary">{x.strength}</Typography>
          </Box>
        ))}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip
          icon={<EmojiEventsIcon />}
          label={harsher ? `${diff} skill harder` : diff < 0 ? `${Math.abs(diff)} skill easier` : "same level"}
          color={harsher ? "warning" : "default"}
          sx={{ fontWeight: 800 }}
        />
        <Typography variant="body2">
          Your <b>Master</b> here is the same <b>top-1/6</b> band as {other.name}, but the room is
          {" "}<b>{harsher ? "stronger" : diff < 0 ? "softer" : "identical"}</b> by ~{Math.abs(diff)} skill.
        </Typography>
      </Stack>
    </Paper>
  );
}

export function SeasonDifficultyPrototype({ variant }: { variant: PrototypeVariant }) {
  if (variant === "B") return <VariantB />;
  if (variant === "C") return <VariantC />;
  return <VariantA />;
}
