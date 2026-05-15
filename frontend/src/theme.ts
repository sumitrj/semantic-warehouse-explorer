import { createTheme } from "@mui/material/styles";

const INDIGO_DARK   = "#1a237e";
const INDIGO_MID    = "#1565c0";
const CYAN          = "#0288d1";

const theme = createTheme({
  palette: {
    mode: "light",
    primary:    { main: INDIGO_DARK, light: "#534bae", dark: "#000051", contrastText: "#ffffff" },
    secondary:  { main: CYAN,        light: "#5eb8ff", dark: "#005b9f", contrastText: "#ffffff" },
    success:    { main: "#2e7d32",   contrastText: "#ffffff" },
    warning:    { main: "#e65100",   contrastText: "#ffffff" },
    error:      { main: "#c62828",   contrastText: "#ffffff" },
    // Keep body text near-black so it reads on any bg
    text: {
      primary:   "#1a1f36",   // very dark navy — not pure black, but ~14:1 on white
      secondary: "#546e7a",   // blue-grey, 4.6:1 on white (WCAG AA)
      disabled:  "#9e9e9e",
    },
    background: { default: "#f0f2f8", paper: "#ffffff" },
    divider: "#dde3f0",
  },

  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 700, letterSpacing: -0.5, color: "#1a1f36" },
    h6: { fontWeight: 600, color: "#1a1f36" },
    subtitle2: { fontWeight: 600, color: "#1a1f36" },
  },

  shape: { borderRadius: 10 },

  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: `linear-gradient(135deg, #0d1b5e 0%, ${INDIGO_DARK} 60%, ${INDIGO_MID} 100%)`,
          color: "#ffffff",
        },
      },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: "1px solid #dde3f0",
          transition: "box-shadow 0.2s ease",
          "&:hover": { boxShadow: "0 2px 12px rgba(26,35,126,0.10)" },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: 11 },
        // Filled chips: always enforce white text on colored bg
        colorPrimary:   { color: "#ffffff" },
        colorSecondary: { color: "#ffffff" },
        colorSuccess:   { color: "#ffffff" },
        colorWarning:   { color: "#ffffff" },
        colorError:     { color: "#ffffff" },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600 },
        // contained variants: white text always
        containedPrimary: {
          background: `linear-gradient(135deg, ${INDIGO_DARK} 0%, ${INDIGO_MID} 100%)`,
          color: "#ffffff",
          "&:hover": {
            background: `linear-gradient(135deg, #000051 0%, ${INDIGO_DARK} 100%)`,
          },
        },
        containedSecondary: {
          background: `linear-gradient(135deg, ${CYAN} 0%, #005b9f 100%)`,
          color: "#ffffff",
        },
        // outlined: colored border + text, white bg — high contrast
        outlinedPrimary: {
          borderColor: INDIGO_DARK,
          color: INDIGO_DARK,
          "&:hover": { bgcolor: "rgba(26,35,126,0.06)" },
        },
        // text buttons: use primary colour on white bg
        textPrimary: { color: INDIGO_DARK },
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          color: "#546e7a",
          borderColor: "#dde3f0",
          "&.Mui-selected": {
            color: INDIGO_DARK,
            backgroundColor: "rgba(26,35,126,0.08)",
            borderColor: INDIGO_DARK,
            "&:hover": { backgroundColor: "rgba(26,35,126,0.12)" },
          },
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 500,
          fontSize: 13,
          minHeight: 48,
          // Tabs are inside AppBar (dark), so inherit white
          color: "rgba(255,255,255,0.75)",
          "&.Mui-selected": { color: "#ffffff", fontWeight: 700 },
        },
      },
    },

    MuiStepIcon: {
      styleOverrides: {
        root: { "&.Mui-active": { color: INDIGO_DARK }, "&.Mui-completed": { color: "#2e7d32" } },
      },
    },

    MuiStepLabel: {
      styleOverrides: {
        label: { fontWeight: 500 },
        labelContainer: { cursor: "pointer" },
      },
    },

    MuiAlert: {
      styleOverrides: {
        // Make sure alert text is always dark enough
        message: { color: "#1a1f36" },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, height: 5 },
      },
    },
  },
});

export default theme;
