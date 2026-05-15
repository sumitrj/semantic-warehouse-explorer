import { useState } from "react";
import {
  AppBar, Toolbar, Typography, Tabs, Tab, Box, Chip, Tooltip,
  Divider, Button,
} from "@mui/material";
import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import RecommendIcon from "@mui/icons-material/Recommend";
import TuneIcon from "@mui/icons-material/Tune";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import PsychologyIcon from "@mui/icons-material/Psychology";

import { Logo } from "./components/Logo";
import { SpaceSelector } from "./components/SpaceSelector";
import { AppContextProvider } from "./state/appContext";

import { SourcesPage } from "./pages/SourcesPage";
import { PreprocessingPage } from "./pages/PreprocessingPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { ActionsPage } from "./pages/ActionsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ConfigWizard } from "./pages/config/ConfigWizard";
import { LLMConfigPage } from "./pages/LLMConfigPage";

type Mode = "explore" | "configure" | "llm";

const EXPLORE_TABS = [
  { label: "Sources",         icon: <StorageIcon fontSize="small" /> },
  { label: "Preprocessing",   icon: <TuneIcon fontSize="small" /> },
  { label: "Explorer",        icon: <BubbleChartIcon fontSize="small" /> },
  { label: "Actions",         icon: <AutoFixHighIcon fontSize="small" /> },
  { label: "Recommendations", icon: <RecommendIcon fontSize="small" /> },
];

function AppShell() {
  const [mode, setMode] = useState<Mode>("explore");
  const [tab, setTab] = useState(2); // default: Explorer

  const modeBtn = (m: Mode, label: string, icon: React.ReactNode) => (
    <Button
      size="small"
      onClick={() => setMode(m)}
      startIcon={icon}
      sx={{
        color: "white",
        bgcolor: mode === m ? "rgba(255,255,255,0.18)" : "transparent",
        "&:hover": { bgcolor: "rgba(255,255,255,0.25)" },
        fontWeight: mode === m ? 700 : 400,
        fontSize: 12,
        px: 1.5,
        py: 0.5,
        borderRadius: 1.5,
        textTransform: "none",
      }}
    >
      {label}
    </Button>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar variant="dense" sx={{ gap: 1, minHeight: 52, px: 2 }}>
          {/* Logo + name */}
          <Logo size={28} />
          <Typography
            variant="h6"
            sx={{ color: "white", fontWeight: 700, fontSize: 15, letterSpacing: -0.5, mr: 0.5, whiteSpace: "nowrap" }}
          >
            Semantic Explorer
          </Typography>

          <Divider orientation="vertical" flexItem sx={{ borderColor: "rgba(255,255,255,0.2)", mx: 0.75 }} />

          {/* Space selector */}
          <SpaceSelector />

          <Divider orientation="vertical" flexItem sx={{ borderColor: "rgba(255,255,255,0.2)", mx: 0.75 }} />

          {/* Mode toggle */}
          {modeBtn("explore",    "Explore",    <BubbleChartIcon fontSize="small" />)}
          {modeBtn("configure",  "Configure",  <SettingsIcon    fontSize="small" />)}
          {modeBtn("llm",        "LLM Config", <PsychologyIcon  fontSize="small" />)}

          {/* Explore sub-tabs — only visible in explore mode */}
          {mode === "explore" && (
            <>
              <Divider orientation="vertical" flexItem sx={{ borderColor: "rgba(255,255,255,0.2)", mx: 0.5 }} />
              <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                textColor="inherit"
                indicatorColor="secondary"
                sx={{ flexGrow: 1 }}
              >
                {EXPLORE_TABS.map((t, i) => (
                  <Tab
                    key={t.label}
                    value={i}
                    label={t.label}
                    icon={t.icon}
                    iconPosition="start"
                    sx={{
                      minHeight: 48, fontSize: 12,
                      color: "rgba(255,255,255,0.8)",
                      "&.Mui-selected": { color: "white" },
                    }}
                  />
                ))}
              </Tabs>
            </>
          )}

          {(mode === "configure" || mode === "llm") && <Box sx={{ flexGrow: 1 }} />}

          {/* LLM badge */}
          <Tooltip title="Exploration/interpretation powered by local LLM via LiteLLM">
            <Chip
              label="local LLM"
              size="small"
              color="secondary"
              variant="outlined"
              icon={<PsychologyIcon style={{ fontSize: 13 }} />}
              sx={{ color: "white", borderColor: "rgba(255,255,255,0.4)", fontSize: 10, flexShrink: 0 }}
            />
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: "hidden" }}>
        {mode === "configure" && <ConfigWizard />}
        {mode === "llm" && <LLMConfigPage />}
        {mode === "explore" && (
          <>
            {tab === 0 && <SourcesPage />}
            {tab === 1 && <PreprocessingPage />}
            {tab === 2 && <ExplorerPage />}
            {tab === 3 && <ActionsPage />}
            {tab === 4 && <RecommendationsPage />}
          </>
        )}
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <AppContextProvider>
      <AppShell />
    </AppContextProvider>
  );
}
