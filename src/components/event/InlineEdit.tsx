import React, { useState } from "react";
import { Box, Typography, TextField, IconButton, Tooltip } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { useT } from "~/lib/useT";

interface Props {
  value: string;
  onSave: (v: string) => void;
  label: string;
}

export function InlineEdit({ value, onSave, label }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => { onSave(draft.trim() || value); setEditing(false); };

  if (!editing) return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Typography variant="h5" fontWeight={700}>{value}</Typography>
      <Tooltip title={t("renameTeam", { label })}>
        <IconButton size="small" onClick={() => { setDraft(value); setEditing(true); }}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <TextField size="small" value={draft} autoFocus
        onChange={(e) => setDraft(e.target.value.slice(0, 50))}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        inputProps={{ maxLength: 50 }} />
      <IconButton size="small" color="primary" onClick={commit}><CheckIcon fontSize="small" /></IconButton>
      <IconButton size="small" onClick={() => setEditing(false)}><CloseIcon fontSize="small" /></IconButton>
    </Box>
  );
}
