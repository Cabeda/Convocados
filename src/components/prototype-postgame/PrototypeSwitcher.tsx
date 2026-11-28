/* eslint-disable -- THROWAWAY prototype */
import { useEffect } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

export interface PrototypeVariantMeta { key: string; name: string }

/** Floating bottom-centre pill. ←/→ cycle, URL ?variant= is the source of truth. Hidden in production builds. */
export function PrototypeSwitcher({ variants, current, onChange }: {
  variants: PrototypeVariantMeta[]; current: string; onChange: (key: string) => void;
}) {
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (delta: number) => onChange(variants[(idx + delta + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  const cur = variants[idx];
  return (
    <Box
      data-testid="prototype-switcher"
      sx={{
        position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2000,
        display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderRadius: 999,
        bgcolor: "#111", color: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
      }}
    >
      <IconButton size="small" aria-label="Previous variant" onClick={() => go(-1)} sx={{ color: "#fff" }}><ChevronLeftIcon /></IconButton>
      <Typography sx={{ fontSize: 14, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{cur.key} ({cur.name})</Typography>
      <IconButton size="small" aria-label="Next variant" onClick={() => go(1)} sx={{ color: "#fff" }}><ChevronRightIcon /></IconButton>
    </Box>
  );
}
