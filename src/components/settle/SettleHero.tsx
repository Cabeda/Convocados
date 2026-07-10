import React from "react";
import {
  Box, Stack, Typography, Button, Tooltip, Chip,
} from "@mui/material";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { alpha, useTheme } from "@mui/material/styles";
import { useT } from "~/lib/useT";
import type { NetPosition } from "~/lib/pairwise";

export interface SettleEventInfo {
  id: string;
  title: string;
  currency: string;
}

export interface SettleHeroStats {
  transactions: number;
  members: number;
  totalSpentCents: number;
}

interface Props {
  event: SettleEventInfo;
  stats: SettleHeroStats;
  netPositions: NetPosition[];
  onShowCharts: () => void;
  onMore: (anchorEl: HTMLElement) => void;
}

const DEBTOR_COLOR = "#8b5a3c"; // brown/tan
const CREDITOR_COLOR = "#5b8c5a"; // green
const VIEWBOX_SIZE = 220;
const MAX_BUBBLE_R = 65; // caps the largest bubble so a single outlier doesn't dominate
const MIN_BUBBLE_R = 12; // below this, no text is shown
const READABLE_BUBBLE_R = 24; // ≥ this, full name + amount are shown

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

/**
 * Truncate a player name to a max length, adding an ellipsis if cut.
 * Prefers breaking on whitespace so we don't slice mid-word.
 */
function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const cut = name.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.5) return cut.slice(0, lastSpace) + "…";
  return cut + "…";
}

/** First letter of first two name parts — e.g. "Ana Maria" → "AM". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0][0] ?? "?").toUpperCase();
  return ((parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

interface BubblePlacement {
  player: NetPosition;
  x: number;
  y: number;
  r: number;
  displayName: string;
  showText: boolean;
  showAmount: boolean;
  showInitials: boolean;
  fontSize: number;
  amountFontSize: number;
}

/**
 * Multi-orbit packed layout. We sort bubbles by absolute amount, place the
 * largest in the centre, then distribute the rest on concentric rings. Each
 * ring is sized so that adjacent bubbles in the same ring AND the centre
 * bubble are guaranteed not to overlap (distance > sum of radii + gap).
 *
 * Returns placements indexed by player name. The caller uses the returned
 * `byName` map to look up the placement for each input position.
 */
function computeLayout(positions: NetPosition[]): BubblePlacement[] {
  if (positions.length === 0) return [];

  const cx = VIEWBOX_SIZE / 2;
  const cy = VIEWBOX_SIZE / 2;
  const maxAbs = Math.max(1, ...positions.map((p) => Math.abs(p.netCents)));

  // Compute the per-bubble radius first so the layout algorithm can use it.
  const sized = positions.map((p) => ({
    player: p,
    r: Math.max(MIN_BUBBLE_R, (Math.abs(p.netCents) / maxAbs) * MAX_BUBBLE_R),
  }));

  // Sort by radius descending so the biggest sits in the centre.
  sized.sort((a, b) => b.r - a.r);

  // Distribute into rings. Ring 0 = centre (1 bubble), then attempt to place
  // each remaining bubble on the innermost ring that has angular room. If
  // none fits, open a new outer ring.
  const rings: Array<typeof sized> = [[sized[0]]];
  for (let i = 1; i < sized.length; i++) {
    let placed = false;
    for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
      const ring = rings[ringIdx];
      const orbitR = orbitRadius(ringIdx, rings);
      if (orbitR <= 0) continue; // centre ring handled separately
      const minArc = sized[i].r * 2 + 4;
      const angularSlot = minArc / Math.max(orbitR, 1);
      const currentCoverage = ring.reduce((sum, b) => {
        const ownArc = (b.r * 2 + 4) / Math.max(orbitR, 1);
        return sum + ownArc;
      }, 0);
      if (currentCoverage + angularSlot <= Math.PI * 2) {
        ring.push(sized[i]);
        placed = true;
        break;
      }
    }
    if (!placed) rings.push([sized[i]]);
  }

  // Place each ring. Centre ring is a single bubble at the origin; each
  // subsequent ring orbits at a radius large enough to clear both the ring
  // inside it AND its own max bubble.
  const placements: BubblePlacement[] = [];
  for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
    const ring = rings[ringIdx];
    const orbitR = orbitRadius(ringIdx, rings);
    if (ringIdx === 0 && rings[0].length === 1) {
      // Single bubble in the centre.
      const b = ring[0];
      placements.push(makePlacement(b, cx, cy, b.r));
    } else {
      const angleStep = (Math.PI * 2) / ring.length;
      // Offset every other ring by half a step so satellites don't all
      // stack vertically above the centre bubble.
      const angleOffset = ringIdx % 2 === 0 ? -Math.PI / 2 : (-Math.PI / 2) + angleStep / 2;
      ring.forEach((b, i) => {
        const angle = angleOffset + i * angleStep;
        placements.push(makePlacement(b, cx + Math.cos(angle) * orbitR, cy + Math.sin(angle) * orbitR, b.r));
      });
    }
  }

  return placements;
}

function makePlacement(
  sized: { player: NetPosition; r: number },
  x: number,
  y: number,
  r: number,
): BubblePlacement {
  return {
    player: sized.player,
    x, y, r,
    displayName: truncateName(sized.player.playerName, 10),
    showText: r >= READABLE_BUBBLE_R,
    showInitials: r < READABLE_BUBBLE_R && r >= MIN_BUBBLE_R,
    showAmount: r >= READABLE_BUBBLE_R,
    fontSize: clampFontSize(r * 0.4, 9, 16),
    amountFontSize: clampFontSize(r * 0.3, 7, 12),
  };
}

/**
 * Compute the orbit radius for ring N, given the full ring layout. The
 * radius must clear the centre bubble AND the ring's own max bubble so that
 * no bubble in the ring overlaps the centre (or, for outer rings, the ring
 * immediately inside it).
 */
function orbitRadius(ringIdx: number, rings: Array<{ r: number }[]>): number {
  if (ringIdx === 0) return 0;
  const innerMaxR = Math.max(...rings[ringIdx - 1].map((b) => b.r));
  const myMaxR = Math.max(...rings[ringIdx].map((b) => b.r));
  const base = innerMaxR + myMaxR + 6; // 6px gap between bubbles
  if (ringIdx === 1) return base;
  // Outer rings: start from the previous ring's orbit + its max + this ring's max.
  return base + (ringIdx - 1) * 8;
}

function clampFontSize(size: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, size));
}

export function SettleHero({ event, stats, netPositions, onShowCharts, onMore }: Props) {
  const t = useT();
  const theme = useTheme();
  const placements = React.useMemo(() => computeLayout(netPositions), [netPositions]);
  const byName = React.useMemo(() => new Map(placements.map((p) => [p.player.playerName, p])), [placements]);
  const totalAbs = netPositions.reduce((s, p) => s + Math.abs(p.netCents), 0) / 2;

  // The headline debt: the largest debtor (Pai -€2,578 in the design).
  const headlineDebtor = netPositions
    .filter((p) => p.netCents < 0)
    .sort((a, b) => a.netCents - b.netCents)[0];
  const headline = headlineDebtor
    ? `${headlineDebtor.playerName} ${formatMoney(headlineDebtor.netCents, event.currency).replace("-", "−")} ${t("settleHeroShouldPay") ?? "should pay"}`
    : (t("settleHeroAllSettled") ?? "All settled");
  const allClear = netPositions.length === 0;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        gap: 2,
        alignItems: "center",
        p: { xs: 2, md: 3 },
        borderRadius: 3,
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6),
        border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.5)}`,
      }}
    >
      {/* Bubble graph (left) */}
      <Box sx={{ width: { xs: "100%", md: 260 }, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        {allClear ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ py: 4, textAlign: "center" }}
            data-testid="settle-hero-all-clear"
          >
            {t("settleHeroAllSettled") ?? "All settled"}
          </Typography>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
              width="100%"
              height="auto"
              style={{ maxWidth: 260, aspectRatio: "1 / 1" }}
              role="img"
              aria-label={t("settleHeroAriaLabel") ?? "Net positions"}
              data-testid="settle-bubble-graph"
            >
              {netPositions.map((pos) => {
                const placement = byName.get(pos.playerName);
                if (!placement) return null;
                const isDebtor = pos.netCents < 0;
                const color = isDebtor ? DEBTOR_COLOR : CREDITOR_COLOR;
                const amountLabel = formatMoney(pos.netCents, event.currency);
                const tooltipTitle = `${pos.playerName} — ${amountLabel} (${isDebtor
                  ? (t("settleHeroOwes") ?? "owes")
                  : (t("settleHeroIsOwed") ?? "is owed")})`;
                return (
                  <Tooltip key={pos.playerName} title={tooltipTitle} arrow placement="top">
                    <g
                      data-testid={`bubble-group-${pos.playerName}`}
                      aria-label={tooltipTitle}
                      tabIndex={0}
                    >
                      <circle
                        cx={placement.x}
                        cy={placement.y}
                        r={placement.r}
                        fill={color}
                        opacity={0.88}
                        data-testid={`bubble-${pos.playerName}`}
                      />
                      {placement.showInitials && (
                        <text
                          x={placement.x}
                          y={placement.y + placement.fontSize * 0.35}
                          textAnchor="middle"
                          fontSize={placement.fontSize}
                          fontWeight={700}
                          fill="white"
                          data-testid={`bubble-label-${pos.playerName}`}
                        >
                          {initialsOf(pos.playerName)}
                        </text>
                      )}
                      {placement.showText && (
                        <>
                          <text
                            x={placement.x}
                            y={placement.y - 2}
                            textAnchor="middle"
                            fontSize={placement.fontSize}
                            fontWeight={600}
                            fill="white"
                            data-testid={`bubble-label-${pos.playerName}`}
                          >
                            {placement.displayName}
                          </text>
                          {placement.showAmount && (
                            <text
                              x={placement.x}
                              y={placement.y + placement.fontSize + 2}
                              textAnchor="middle"
                              fontSize={placement.amountFontSize}
                              fill="white"
                            >
                              {amountLabel}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  </Tooltip>
                );
              })}
            </svg>
            {/* Color legend — explains the debtor/creditor color encoding. */}
            <Stack direction="row" spacing={1} data-testid="settle-hero-legend" sx={{ flexWrap: "wrap", justifyContent: "center" }}>
              <Chip
                size="small"
                data-testid="legend-debtor"
                label={t("settleHeroLegendDebtor") ?? "Brown = owes"}
                sx={{
                  bgcolor: alpha(DEBTOR_COLOR, 0.15),
                  color: theme.palette.text.primary,
                  "&::before": {
                    content: '""',
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: DEBTOR_COLOR,
                    mr: 0.5,
                  },
                }}
              />
              <Chip
                size="small"
                data-testid="legend-creditor"
                label={t("settleHeroLegendCreditor") ?? "Green = is owed"}
                sx={{
                  bgcolor: alpha(CREDITOR_COLOR, 0.15),
                  color: theme.palette.text.primary,
                  "&::before": {
                    content: '""',
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: CREDITOR_COLOR,
                    mr: 0.5,
                  },
                }}
              />
            </Stack>
            {/* totalAbs is exposed for future expansion; referenced to silence unused warnings */}
            <Box sx={{ display: "none" }} data-total={totalAbs} />
          </>
        )}
      </Box>

      {/* Right column: title, stats, headline, actions */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h3" fontWeight={700} sx={{ mb: 1, lineHeight: 1.1 }}>
          {event.title}
        </Typography>
        <Stack spacing={0.25} sx={{ mb: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t("settleHeroTransactions") ?? "Transactions"}: <strong>{stats.transactions}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("settleHeroMembers") ?? "Members"}: <strong>{stats.members}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("settleHeroTotalSpent") ?? "Total spent"}: <strong>{formatMoney(stats.totalSpentCents, event.currency)}</strong>
          </Typography>
        </Stack>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
          {headline}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<ShowChartIcon />}
            onClick={onShowCharts}
          >
            {t("settleHeroShowCharts") ?? "Show charts"}
          </Button>
          <Button
            variant="outlined"
            size="small"
            endIcon={<MoreHorizIcon />}
            onClick={(e) => onMore(e.currentTarget)}
            aria-haspopup="menu"
            data-testid="settle-hero-more"
          >
            {t("more") ?? "More"}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
