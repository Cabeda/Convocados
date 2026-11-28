/* eslint-disable -- THROWAWAY prototype */
import type { ReactNode } from "react";
import { Alert, Box, Typography } from "@mui/material";
import type { PrototypeModel } from "./prototypePostGameData";

export function PrototypeMockTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color: "warning.dark", ml: 0.75, whiteSpace: "nowrap" }}>
      (mock)
    </Typography>
  );
}

export function PrototypeSignInNotice({ model }: { model: PrototypeModel }) {
  if (model.signedIn && !model.viewer.isMock) return null;
  return (
    <Alert severity="info" sx={{ fontSize: 14, borderRadius: 2 }}>
      {model.signedIn
        ? "You're signed in but not on this game's roster — your personal bits (team, payment, vote) are mock."
        : <>Sign in as <b>demo@convocados.app / demo123</b> (open <a href="/auth/signin" target="_blank" rel="noreferrer">/auth/signin</a> in this browser, then reload). Personal bits are mock until then.</>}
    </Alert>
  );
}

export function PrototypePhoneFrame({ label, note, height = 844, noScroll = false, children }: {
  label: string; note: string; height?: number; noScroll?: boolean; children: ReactNode;
}) {
  // ?full=1 → frames grow to their content (for full-length screenshots/review)
  const full = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("full") === "1";
  return (
    <Box sx={{ flex: "0 0 auto", width: 390 + 20 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1, textAlign: "center", color: "#1f2933" }}>{label}</Typography>
      <Box
        sx={{
          width: 390 + 20, height: full ? "auto" : height + 20, boxSizing: "border-box", border: "10px solid #1f2933",
          borderRadius: "36px", overflow: full ? "visible" : noScroll ? "hidden" : "auto", bgcolor: "background.default", boxShadow: 6,
        }}
      >
        <Box sx={{ width: 390, minHeight: "100%", margin: "0 auto" }}>{children}</Box>
      </Box>
      <Typography sx={{ mt: 1, fontSize: 13, color: "#3e4c59", textAlign: "center", px: 1 }}>{note}</Typography>
    </Box>
  );
}
