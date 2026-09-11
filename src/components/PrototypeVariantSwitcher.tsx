/**
 * PROTOTYPE — throwaway.
 *
 * Floating bottom bar that cycles UI variants via the `?variant=` search param.
 * Hidden in production builds. Shared by any UI prototype route.
 *
 * Question it answers: "how do we show that one event is harder than another?"
 */
import { useCallback, useEffect, useState } from "react";
import { Box, IconButton, Paper, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

export const PROTOTYPE_VARIANTS = ["A", "B", "C"] as const;
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number];

function readVariant(): PrototypeVariant {
  if (typeof window === "undefined") return "A";
  const value = new URL(window.location.href).searchParams.get("variant");
  return (PROTOTYPE_VARIANTS as readonly string[]).includes(value ?? "")
    ? (value as PrototypeVariant)
    : "A";
}

function writeVariant(variant: PrototypeVariant) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  window.history.replaceState({}, "", url.toString());
}

export function usePrototypeVariant(): readonly [PrototypeVariant, (next: PrototypeVariant) => void] {
  const [variant, setVariant] = useState<PrototypeVariant>(readVariant);
  const set = useCallback((next: PrototypeVariant) => {
    setVariant(next);
    writeVariant(next);
  }, []);
  return [variant, set] as const;
}

export function PrototypeVariantSwitcher({
  current,
  onChange,
  labels,
}: {
  current: PrototypeVariant;
  onChange: (next: PrototypeVariant) => void;
  labels?: Partial<Record<PrototypeVariant, string>>;
}) {
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = PROTOTYPE_VARIANTS.indexOf(current);
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const next = PROTOTYPE_VARIANTS[(index + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length];
      event.preventDefault();
      onChange(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onChange]);

  if (import.meta.env.PROD) return null;

  const index = PROTOTYPE_VARIANTS.indexOf(current);
  const cycle = (delta: number) => {
    const next = PROTOTYPE_VARIANTS[(index + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length];
    onChange(next);
  };
  const label = labels?.[current] ?? current;

  return (
    <Paper
      elevation={8}
      sx={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        borderRadius: 999,
        px: 1,
        py: 0.5,
        display: "flex",
        alignItems: "center",
        gap: 1,
        bgcolor: "grey.900",
        color: "common.white",
        border: "1px solid rgba(255,255,255,0.2)",
      }}
    >
      <IconButton size="small" sx={{ color: "common.white" }} aria-label="Previous variant" onClick={() => cycle(-1)}>
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <Box sx={{ minWidth: 180, textAlign: "center" }}>
        <Typography variant="caption" sx={{ opacity: 0.55, letterSpacing: 1, display: "block", lineHeight: 1 }}>
          PROTOTYPE
        </Typography>
        <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
          {current} · {label}
        </Typography>
      </Box>
      <IconButton size="small" sx={{ color: "common.white" }} aria-label="Next variant" onClick={() => cycle(1)}>
        <ChevronRightIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
}
