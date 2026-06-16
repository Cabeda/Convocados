import React from "react";
import { TextField, Autocomplete, InputAdornment, IconButton, Tooltip, Box } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ShieldIcon from "@mui/icons-material/Shield";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import type { PlayerOption } from "./types";
import type { AddPlayerIntent } from "./AddPlayerConfirmDialog";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Direct add (Enter / IconButton / create-option Enter). No confirmation. */
  onAdd: (name: string) => void;
  /** Confirm-required add (dropdown row tap). Optional — falls back to onAdd. */
  onRequestAdd?: (intent: AddPlayerIntent) => void;
  suggestions: { name: string; gamesPlayed: number; userId?: string | null }[];
  disabled?: boolean;
  label?: string;
}

export function PlayerAutocomplete({ value, onChange, onAdd, onRequestAdd, suggestions, disabled, label }: Props) {
  const t = useT();
  const dispatchAdd = (name: string) => {
    if (onRequestAdd) onRequestAdd({ kind: "single", name, source: "dropdown" });
    else onAdd(name);
  };

  return (
    <Autocomplete<PlayerOption, false, false, true>
      freeSolo
      size="small"
      options={(() => {
        const trimmed = value.trim();
        const filtered: PlayerOption[] = suggestions
          .filter((s) => matchesWithName(s.name, trimmed))
          .map((s) => ({
            type: "existing" as const,
            name: s.name,
            gamesPlayed: s.gamesPlayed,
            userId: s.userId ?? null,
          }));
        if (trimmed && !filtered.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
          filtered.push({ type: "create" as const, name: trimmed });
        }
        return filtered;
      })()}
      filterOptions={(options) => options}
      getOptionLabel={(option) => (typeof option === "string" ? option : option.name)}
      isOptionEqualToValue={(option, value) => option.type === value.type && option.name === value.name}
      value={null}
      inputValue={value}
      onInputChange={(_, newInputValue, reason) => {
        if (reason === "reset") return;
        onChange(newInputValue);
      }}
      onChange={(_, newValue) => {
        if (!newValue) return;
        const name = typeof newValue === "string" ? newValue.trim() : newValue.name;
        if (name) {
          // Dropdown row tap — single-tap surface, requires confirmation if
          // a request handler is provided; otherwise direct add (e.g. for
          // historical-game dialogs that don't have the confirmation flow).
          dispatchAdd(name);
          onChange("");
        }
      }}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={t("addPlayerPlaceholder")}
          inputProps={{ ...params.inputProps, maxLength: 50 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              const trimmed = value.trim();
              const hasMatch = suggestions.some((s) => matchesWithName(s.name, trimmed));
              if (!hasMatch) {
                e.preventDefault();
                e.stopPropagation();
                onAdd(trimmed);
                onChange("");
              }
            }
          }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" color="primary" edge="end"
                  disabled={!value.trim() || disabled}
                  onClick={() => { onAdd(value.trim()); onChange(""); }}>
                  <PersonAddIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
        />
      )}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
        if (option.type === "create") {
          return (
            <li key={key} {...otherProps} style={{ minHeight: 40, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
              <PersonAddIcon fontSize="small" color="primary" />
              {t("createNewPlayer", { name: option.name })}
            </li>
          );
        }
        return (
          <li key={key} {...otherProps} style={{ minHeight: 40, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, overflow: "hidden" }}>
              {option.userId ? (
                <Tooltip title={t("protectedPlayer")}>
                  <ShieldIcon fontSize="small" sx={{ color: "primary.main", flexShrink: 0 }} />
                </Tooltip>
              ) : null}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
            </Box>
            {option.gamesPlayed > 0 && (
              <span style={{ color: "text.secondary", fontSize: "0.75rem", marginLeft: 8, flexShrink: 0 }}>
                {t("nGamesPlayed", { n: option.gamesPlayed })}
              </span>
            )}
          </li>
        );
      }}
      noOptionsText={t("noSuggestions")}
    />
  );
}
