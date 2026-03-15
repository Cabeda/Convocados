import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import { ThemeProvider, createTheme, type PaletteMode } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";

type ThemeModeContextType = {
  mode: PaletteMode;
  toggleMode: () => void;
};

const ThemeModeContext = createContext<ThemeModeContextType>({
  mode: "light",
  toggleMode: () => {},
});

export const useThemeMode = () => useContext(ThemeModeContext);

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<PaletteMode>("light");

  useEffect(() => {
    const stored = localStorage.getItem("themeMode");
    if (stored === "light" || stored === "dark") {
      setMode(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setMode("dark");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("themeMode", mode);
  }, [mode]);

  const toggleMode = () => setMode((prev) => (prev === "light" ? "dark" : "light"));

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          // M3-inspired tonal palette
          primary: {
            main: mode === "light" ? "#1b6b4a" : "#7edcab",
            light: mode === "light" ? "#4e9d7a" : "#a8ecc8",
            dark: mode === "light" ? "#004d2e" : "#4faa80",
            contrastText: mode === "light" ? "#ffffff" : "#003822",
          },
          secondary: {
            main: mode === "light" ? "#4a6358" : "#b2ccbf",
            light: mode === "light" ? "#7b9489" : "#cee8da",
            dark: mode === "light" ? "#1d3a2e" : "#8aab9c",
          },
          error: {
            main: mode === "light" ? "#ba1a1a" : "#ffb4ab",
          },
          warning: {
            main: mode === "light" ? "#7d5700" : "#f5bf48",
          },
          success: {
            main: mode === "light" ? "#1b6b4a" : "#7edcab",
          },
          background: {
            default: mode === "light" ? "#f8faf6" : "#111412",
            paper: mode === "light" ? "#ffffff" : "#1a1d1b",
          },
          divider: mode === "light" ? "#c2c9c1" : "#3a3f3b",
        },
        typography: {
          fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
          h4: { fontWeight: 700, letterSpacing: "-0.02em" },
          h5: { fontWeight: 700, letterSpacing: "-0.01em" },
          h6: { fontWeight: 600 },
          button: { textTransform: "none", fontWeight: 600, letterSpacing: "0.01em" },
        },
        shape: { borderRadius: 12 },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: "none",
                fontWeight: 600,
                borderRadius: 20,
                paddingInline: 20,
              },
              contained: {
                boxShadow: "none",
                "&:hover": { boxShadow: "none" },
              },
              outlined: {
                borderWidth: 1.5,
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                borderRadius: 8,
                fontWeight: 500,
              },
              outlined: {
                borderWidth: 1.5,
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: "none",
              },
            },
            defaultProps: {
              elevation: 0,
            },
          },
          MuiAppBar: {
            styleOverrides: {
              root: {
                boxShadow: "none",
              },
            },
          },
          MuiTextField: {
            styleOverrides: {
              root: {
                "& .MuiOutlinedInput-root": {
                  borderRadius: 12,
                },
              },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: {
                borderRadius: 20,
              },
            },
          },
          MuiAlert: {
            styleOverrides: {
              root: {
                borderRadius: 12,
              },
            },
          },
        },
      }),
    [mode]
  );

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};
