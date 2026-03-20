import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";

const theme = createTheme({
  palette: { mode: "light", primary: { main: "#1b6b4a" } },
});

/**
 * Render wrapper that provides MUI theme context.
 * Use instead of raw `render()` for component tests.
 */
export function renderWithTheme(ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, {
    wrapper: ({ children }) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    ),
    ...options,
  });
}
