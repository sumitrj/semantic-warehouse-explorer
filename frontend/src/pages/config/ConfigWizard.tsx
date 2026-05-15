/**
 * Configuration Wizard — 5-step stepper for setting up Semantic Explorer.
 *
 * Steps:
 *  1. Space — select or create a Table Space
 *  2. Table Explorer — review the space's tables
 *  3. EDA (column-level statistical analysis)
 *  4. Associations Builder (join discovery + confirmation)
 *  5. ML Tools Configuration (exploration vs prediction)
 *
 * The wizard is scoped to the active TableSpace. Source ID and tables are
 * derived from the space, not entered manually.
 */
import { createContext, useContext, useState, useCallback } from "react";
import {
  Box, Stepper, Step, StepLabel, StepButton, Paper, Typography,
  Button, Divider, Alert, LinearProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { Logo } from "../../components/Logo";
import { SpaceStep } from "./Step1_Space";
import { TableExplorerStep } from "./Step2_TableExplorer";
import { EDAStep } from "./Step3_EDA";
import { AssociationsStep } from "./Step4_Associations";
import { MLConfigStep } from "./Step5_MLConfig";
import type { UUID, TableSpace } from "../../api/client";

// ─── Wizard state context ─────────────────────────────────────────────────────

export interface WizardState {
  activeSpace: TableSpace | null;
  setActiveSpace: (s: TableSpace | null) => void;
  selectedTables: string[];
  setSelectedTables: (t: string[]) => void;
  edaDone: boolean;
  setEdaDone: (v: boolean) => void;
  joinsDone: boolean;
  setJoinsDone: (v: boolean) => void;
  mlDone: boolean;
  setMlDone: (v: boolean) => void;
}

const WizardCtx = createContext<WizardState | null>(null);
export const useWizard = () => {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard must be used inside ConfigWizard");
  return ctx;
};

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { label: "Space",          subtitle: "Select or create a space" },
  { label: "Table Explorer", subtitle: "Review working tables" },
  { label: "EDA",            subtitle: "Analyse column semantics" },
  { label: "Associations",   subtitle: "Discover and confirm joins" },
  { label: "ML Config",      subtitle: "Choose models & tasks" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function ConfigWizard() {
  const [step, setStep] = useState(0);

  const [activeSpace, setActiveSpaceState] = useState<TableSpace | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [edaDone, setEdaDone] = useState(false);
  const [joinsDone, setJoinsDone] = useState(false);
  const [mlDone, setMlDone] = useState(false);

  const setActiveSpace = useCallback((s: TableSpace | null) => {
    setActiveSpaceState(s);
    // Pre-populate table selection from space
    if (s) setSelectedTables(s.tables);
  }, []);

  const stepCompleted = useCallback((i: number) => {
    if (i === 0) return !!activeSpace;
    if (i === 1) return selectedTables.length > 0;
    if (i === 2) return edaDone;
    if (i === 3) return joinsDone;
    if (i === 4) return mlDone;
    return false;
  }, [activeSpace, selectedTables, edaDone, joinsDone, mlDone]);

  const canNavigate = (i: number) => i === 0 || stepCompleted(i - 1);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const completedCount = STEPS.filter((_, i) => stepCompleted(i)).length;
  const progress = (completedCount / STEPS.length) * 100;

  return (
    <WizardCtx.Provider value={{
      activeSpace, setActiveSpace,
      selectedTables, setSelectedTables,
      edaDone, setEdaDone,
      joinsDone, setJoinsDone,
      mlDone, setMlDone,
    }}>
      <Box sx={{ display: "flex", height: "100%", overflow: "hidden", bgcolor: "background.default" }}>
        {/* Left sidebar — stepper */}
        <Paper
          elevation={0}
          sx={{
            width: 240, flexShrink: 0, height: "100%", overflowY: "auto",
            borderRight: "1px solid #dde3f0",
            display: "flex", flexDirection: "column",
          }}
        >
          {/* Header */}
          <Box sx={{ p: 2.5, pb: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Logo size={26} />
            <Box>
              <Typography variant="subtitle2" sx={{ color: "primary.main", lineHeight: 1.2 }}>
                Setup Wizard
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {completedCount} / {STEPS.length} complete
              </Typography>
            </Box>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{ mx: 2.5, mb: 2, borderRadius: 4, height: 4 }}
          />

          <Divider />

          <Stepper
            orientation="vertical"
            nonLinear
            activeStep={step}
            sx={{ p: 2, flexGrow: 1 }}
          >
            {STEPS.map((s, i) => (
              <Step key={s.label} completed={stepCompleted(i)}>
                <StepButton
                  onClick={() => canNavigate(i) && setStep(i)}
                  disabled={!canNavigate(i)}
                  sx={{ py: 1, borderRadius: 2, "&:hover": { bgcolor: "action.hover" } }}
                >
                  <StepLabel
                    StepIconComponent={stepCompleted(i) ? () => (
                      <CheckCircleIcon sx={{ color: "success.main", fontSize: 22 }} />
                    ) : undefined}
                    optional={
                      <Typography variant="caption" color="text.secondary">
                        {s.subtitle}
                      </Typography>
                    }
                  >
                    <Typography
                      variant="body2"
                      fontWeight={step === i ? 700 : 500}
                      color={step === i ? "primary.main" : "text.primary"}
                    >
                      {s.label}
                    </Typography>
                  </StepLabel>
                </StepButton>
              </Step>
            ))}
          </Stepper>

          {completedCount === STEPS.length && (
            <Box sx={{ p: 2 }}>
              <Alert severity="success" sx={{ fontSize: 12 }}>
                Configuration complete! Switch to Explore to start.
              </Alert>
            </Box>
          )}
        </Paper>

        {/* Right — step content */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflowY: "auto", p: 3 }}>
            {step === 0 && <SpaceStep />}
            {step === 1 && <TableExplorerStep />}
            {step === 2 && <EDAStep />}
            {step === 3 && <AssociationsStep />}
            {step === 4 && <MLConfigStep />}
          </Box>

          {/* Navigation footer */}
          <Box
            sx={{
              borderTop: "1px solid #dde3f0",
              px: 3, py: 1.5,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              bgcolor: "background.paper",
            }}
          >
            <Button variant="outlined" onClick={back} disabled={step === 0} size="small">
              Back
            </Button>
            <Typography variant="caption" color="text.secondary">
              Step {step + 1} of {STEPS.length} — {STEPS[step].label}
            </Typography>
            <Button
              variant="contained"
              onClick={next}
              disabled={!stepCompleted(step)}
              size="small"
            >
              {step === STEPS.length - 1 ? "Finish" : "Next"}
            </Button>
          </Box>
        </Box>
      </Box>
    </WizardCtx.Provider>
  );
}
