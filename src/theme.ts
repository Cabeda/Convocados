import { createTheme, PaletteMode } from '@mui/material/styles';

// Function to create theme based on mode
export const createAppTheme = (mode: PaletteMode) => {
  return createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            // Light mode palette
            primary: {
              main: '#6200ee',
              light: '#985eff',
              dark: '#0000ba',
              contrastText: '#ffffff',
            },
            secondary: {
              main: '#03dac6',
              light: '#66fff9',
              dark: '#00a896',
              contrastText: '#000000',
            },
            background: {
              default: '#f5f5f5',
              paper: '#ffffff',
            },
          }
        : {
            // Dark mode palette
            primary: {
              main: '#bb86fc',
              light: '#efdcff',
              dark: '#8858c8',
              contrastText: '#000000',
            },
            secondary: {
              main: '#03dac6',
              light: '#66fff9',
              dark: '#00a896',
              contrastText: '#000000',
            },
            background: {
              default: '#121212',
              paper: '#1e1e1e',
            },
            text: {
              primary: '#e0e0e0',
              secondary: '#a0a0a0',
            },
          }),
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontWeight: 500,
      },
      h2: {
        fontWeight: 500,
      },
      button: {
        textTransform: 'none',
        fontWeight: 500,
      },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            padding: '10px 20px',
          },
          contained: {
            boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.1)',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.05)',
            borderRadius: 12,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            transition: 'background-color 0.3s ease',
          },
        },
      },
    },
    breakpoints: {
      values: {
        xs: 0,
        sm: 600,
        md: 960,
        lg: 1280,
        xl: 1920,
      },
    },
  });
};

// Default theme
export const theme = createAppTheme('light');
