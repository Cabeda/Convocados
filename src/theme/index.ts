import type { PaletteMode, ThemeOptions } from "@mui/material/styles";
import { tokens, type PaletteTokens, type DesignTokens } from "./tokens";

export { tokens } from "./tokens";
export type { DesignTokens, PaletteTokens } from "./tokens";

function paletteForMode(mode: PaletteMode, t: DesignTokens) {
  return {
    mode,
    primary: { ...t.palette[mode].primary },
    secondary: { ...t.palette[mode].secondary },
    error: { ...t.palette[mode].error },
    warning: { ...t.palette[mode].warning },
    success: { ...t.palette[mode].success },
    background: { ...t.palette[mode].background },
    divider: t.palette[mode].divider,
  };
}

export function buildThemeOptions(mode: PaletteMode): ThemeOptions {
  const t = tokens;
  const c = t.components;

  return {
    palette: paletteForMode(mode, t),
    typography: {
      fontFamily: t.typography.fontFamily,
      h4: { fontWeight: t.typography.h4.fontWeight, letterSpacing: t.typography.h4.letterSpacing },
      h5: { fontWeight: t.typography.h5.fontWeight, letterSpacing: t.typography.h5.letterSpacing },
      h6: { fontWeight: t.typography.h6.fontWeight },
      button: { textTransform: c.button.textTransform, fontWeight: c.button.fontWeight, letterSpacing: t.typography.button.letterSpacing },
    },
    shape: { borderRadius: t.shape.borderRadius },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: c.button.textTransform,
            fontWeight: c.button.fontWeight,
            borderRadius: c.button.borderRadius,
            paddingInline: c.button.paddingInline,
          },
          contained: {
            boxShadow: c.button.contained.boxShadow,
            "&:hover": { boxShadow: c.button.contained.boxShadow },
          },
          outlined: {
            borderWidth: 1.5,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: c.chip.borderRadius,
            fontWeight: c.chip.fontWeight,
          },
          outlined: {
            borderWidth: c.chip.outlinedBorderWidth,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: c.paper.backgroundImage,
          },
        },
        defaultProps: {
          elevation: 0,
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: c.appBar.boxShadow,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: c.textField.borderRadius,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: c.dialog.borderRadius,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: c.alert.borderRadius,
          },
        },
      },
    },
  };
}
