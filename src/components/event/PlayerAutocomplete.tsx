import React from "react";
import { TextField, Autocomplete, InputAdornment, IconButton } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import type { PlayerOption } from "./types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onAdd: (name: string) => void;
  suggestions: { name: string; gamesPlayed: number }[];
  disabled?: boolean;
  label?: string;
}

export function PlayerAutocomplete({ value, onChange, onAdd, suggestions, disabled, label }: Props) {
  const t = useT();

  return (
    <Autocomplete<PlayerOption, false, false, true>
      freeSolo
      size="small"
      options={(() => {
        const trimmed = value.trim();
        const filtered: PlayerOption[] = suggestions
          .filter((s) => matchesWithName(s.name, trimmed))
          .map((s) => ({ type: "existing" as const, name: s.name, gamesPlayed: s.gamesPlayed }));
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
        if (name) { onAdd(name); onChange(""); }
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
        const { key, ...otherProps } = props as any;
        if (option.type === "create") {
          return (
            <li key={key} {...otherProps} style={{ minHeight: 40, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
              <PersonAddIcon fontSize="small" color="primary" />
              {t("createNewPlayer", { name: option.name })}
            </li>
          );
        }
        return (
          <li key={key} {...otherProps} style={{ minHeight: 40, display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span>{option.name}</span>
            {option.gamesPlayed > 0 && (
              <span style={{ color: "text.secondary", fontSize: "0.75rem", marginLeft: 8 }}>
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
