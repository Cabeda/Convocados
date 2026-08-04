import React, { createContext, use, useMemo, useState, useEffect } from "react";
import { ThemeProvider, createTheme, type PaletteMode } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import { buildThemeOptions } from "../theme";

type ThemeModeContextType = {
  mode: PaletteMode;
  toggleMode: () => void;
};

const ThemeModeContext = createContext<ThemeModeContextType>({
  mode: "light",
  toggleMode: () => {},
});

export const useThemeMode = () => use(ThemeModeContext);

function getInitialMode(): PaletteMode {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("themeMode");
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<PaletteMode>(getInitialMode);

  useEffect(() => {
    localStorage.setItem("themeMode", mode);
  }, [mode]);

  const toggleMode = () => setMode((prev) => (prev === "light" ? "dark" : "light"));

  const theme = useMemo(
    () => createTheme(buildThemeOptions(mode)),
    [mode]
  );

  return (
    <ThemeModeContext value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext>
  );
};
