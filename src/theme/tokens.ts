export type PaletteMode = "light" | "dark";

export interface PaletteTokens {
  primary: { main: string; light: string; dark: string; contrastText: string };
  secondary: { main: string; light: string; dark: string };
  error: { main: string };
  warning: { main: string };
  success: { main: string };
  background: { default: string; paper: string };
  divider: string;
}

export interface TypographyTokens {
  fontFamily: string;
  h4: { fontWeight: number; letterSpacing: string };
  h5: { fontWeight: number; letterSpacing: string };
  h6: { fontWeight: number };
  button: { textTransform: string; fontWeight: number; letterSpacing: string };
}

export interface ComponentTokens {
  button: {
    borderRadius: number;
    paddingInline: number;
    textTransform: string;
    fontWeight: number;
    contained: { boxShadow: string };
  };
  chip: {
    borderRadius: number;
    fontWeight: number;
    outlinedBorderWidth: number;
  };
  paper: { backgroundImage: string };
  appBar: { boxShadow: string };
  textField: { borderRadius: number };
  dialog: { borderRadius: number };
  alert: { borderRadius: number };
}

export interface DesignTokens {
  palette: { light: PaletteTokens; dark: PaletteTokens };
  typography: TypographyTokens;
  shape: { borderRadius: number };
  components: ComponentTokens;
}

export const tokens: DesignTokens = {
  palette: {
    light: {
      primary: { main: "#1b6b4a", light: "#4e9d7a", dark: "#004d2e", contrastText: "#ffffff" },
      secondary: { main: "#4a6358", light: "#7b9489", dark: "#1d3a2e" },
      error: { main: "#ba1a1a" },
      warning: { main: "#7d5700" },
      success: { main: "#1b6b4a" },
      background: { default: "#f8faf6", paper: "#ffffff" },
      divider: "#c2c9c1",
    },
    dark: {
      primary: { main: "#7edcab", light: "#a8ecc8", dark: "#4faa80", contrastText: "#003822" },
      secondary: { main: "#b2ccbf", light: "#cee8da", dark: "#8aab9c" },
      error: { main: "#ffb4ab" },
      warning: { main: "#f5bf48" },
      success: { main: "#7edcab" },
      background: { default: "#111412", paper: "#1a1d1b" },
      divider: "#3a3f3b",
    },
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
    button: {
      borderRadius: 20,
      paddingInline: 20,
      textTransform: "none",
      fontWeight: 600,
      contained: { boxShadow: "none" },
    },
    chip: {
      borderRadius: 8,
      fontWeight: 500,
      outlinedBorderWidth: 1.5,
    },
    paper: { backgroundImage: "none" },
    appBar: { boxShadow: "none" },
    textField: { borderRadius: 12 },
    dialog: { borderRadius: 20 },
    alert: { borderRadius: 12 },
  },
};
