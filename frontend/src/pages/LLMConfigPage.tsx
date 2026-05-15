/**
 * LLM Config page — manage prompts and inference parameters for each
 * cognitive function (describe_cluster, describe_cluster_narrative,
 * recommend_cluster, recommend_entity).
 *
 * Left panel: function list cards showing current model/temperature/max_tokens.
 * Right panel: split editor for the selected function:
 *   - Inference params (model, temperature, max_tokens)
 *   - System prompt textarea
 *   - User template textarea + variables reference
 *   - Prompt history with one-click activation
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, IconButton,
  InputAdornment, Paper, Slider, Stack, Tab, Tabs, TextField,
  Tooltip, Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/History";
import CodeIcon from "@mui/icons-material/Code";
import TuneIcon from "@mui/icons-material/Tune";
import RestoreIcon from "@mui/icons-material/Restore";
import { api, type LLMFunctionConfigOut, type PromptTemplateOut } from "../api/client";

// ─── Function card (left panel) ───────────────────────────────────────────────
function FunctionCard({
  cfg,
  selected,
  onClick,
}: {
  cfg: LLMFunctionConfigOut;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        p: 1.5, mb: 1, cursor: "pointer", borderRadius: 2,
        border: "1.5px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "primary.50" : "background.paper",
        transition: "border-color 0.15s, background-color 0.15s",
        "&:hover": { borderColor: "primary.light" },
      }}
    >
      <Typography variant="body2" fontWeight={700} color={selected ? "primary.main" : "text.primary"}>
        {cfg.display_name}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
        {cfg.description}
      </Typography>
      <Stack direction="row" gap={0.75} mt={0.75} flexWrap="wrap">
        <Chip label={cfg.effective_model.split("/").pop()} size="small" variant="outlined" sx={{ fontSize: 10 }} />
        <Chip label={`T ${cfg.temperature}`} size="small" sx={{ fontSize: 10 }} />
        <Chip label={`${cfg.max_tokens} tok`} size="small" sx={{ fontSize: 10 }} />
        {cfg.active_prompt && (
          <Chip
            label={cfg.active_prompt.version}
            size="small"
            color="success"
            variant="outlined"
            sx={{ fontSize: 10 }}
          />
        )}
      </Stack>
    </Paper>
  );
}

// ─── Prompt history row ───────────────────────────────────────────────────────
function HistoryRow({
  prompt,
  isActive,
  onActivate,
}: {
  prompt: PromptTemplateOut;
  isActive: boolean;
  onActivate: () => void;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      sx={{ py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}
    >
      {isActive
        ? <CheckCircleIcon sx={{ fontSize: 16, color: "success.main", flexShrink: 0 }} />
        : <Box sx={{ width: 16, flexShrink: 0 }} />
      }
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" fontWeight={600} noWrap>{prompt.name}</Typography>
        <Typography variant="caption" color="text.disabled" sx={{ display: "block" }}>
          {prompt.version} · {new Date(prompt.created_at).toLocaleDateString()}
        </Typography>
      </Box>
      {!isActive && (
        <Tooltip title="Activate this version">
          <IconButton size="small" onClick={onActivate}><RestoreIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      {isActive && <Chip label="active" size="small" color="success" sx={{ fontSize: 10 }} />}
    </Stack>
  );
}

// ─── Right panel editor ───────────────────────────────────────────────────────
function FunctionEditor({
  cfg: initialCfg,
  onSaved,
}: {
  cfg: LLMFunctionConfigOut;
  onSaved: (updated: LLMFunctionConfigOut) => void;
}) {
  const [cfg, setCfg] = useState(initialCfg);
  const [tab, setTab] = useState(0);

  // Params state
  const [model, setModel] = useState(cfg.model ?? "");
  const [temperature, setTemperature] = useState(cfg.temperature);
  const [maxTokens, setMaxTokens] = useState(cfg.max_tokens);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [paramsSaving, setParamsSaving] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);

  // Prompt state
  const [systemPrompt, setSystemPrompt] = useState(cfg.active_prompt?.system_prompt ?? "");
  const [userTemplate, setUserTemplate] = useState(cfg.active_prompt?.user_template ?? "");
  const [promptName, setPromptName] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<PromptTemplateOut[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Reset when cfg changes (different function selected)
  useEffect(() => {
    setCfg(initialCfg);
    setModel(initialCfg.model ?? "");
    setTemperature(initialCfg.temperature);
    setMaxTokens(initialCfg.max_tokens);
    setSystemPrompt(initialCfg.active_prompt?.system_prompt ?? "");
    setUserTemplate(initialCfg.active_prompt?.user_template ?? "");
    setPromptName("");
    setParamsDirty(false);
    setPromptDirty(false);
    setParamsError(null);
    setPromptError(null);
  }, [initialCfg.function_name]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await api.listPrompts(cfg.function_name));
    } finally {
      setHistoryLoading(false);
    }
  }, [cfg.function_name]);

  useEffect(() => {
    if (tab === 2) loadHistory();
  }, [tab, loadHistory]);

  const saveParams = async () => {
    setParamsSaving(true);
    setParamsError(null);
    try {
      const updated = await api.patchLLMFunction(cfg.function_name, {
        model: model || undefined,
        temperature,
        max_tokens: maxTokens,
      });
      setCfg(updated);
      onSaved(updated);
      setParamsDirty(false);
    } catch (e: any) {
      setParamsError(e.message);
    } finally {
      setParamsSaving(false);
    }
  };

  const savePrompt = async () => {
    if (!systemPrompt.trim() || !userTemplate.trim()) {
      setPromptError("System prompt and user template are required.");
      return;
    }
    setPromptSaving(true);
    setPromptError(null);
    try {
      const name = promptName.trim() || `${cfg.display_name} — edited`;
      await api.createPrompt(cfg.function_name, {
        name,
        system_prompt: systemPrompt,
        user_template: userTemplate,
        variables: cfg.active_prompt?.variables ?? [],
        activate: true,
      });
      const updated = await api.getLLMFunction(cfg.function_name);
      setCfg(updated);
      onSaved(updated);
      setPromptDirty(false);
      setPromptName("");
      if (tab === 2) loadHistory();
    } catch (e: any) {
      setPromptError(e.message);
    } finally {
      setPromptSaving(false);
    }
  };

  const activateHistoryPrompt = async (promptId: string) => {
    try {
      const updated = await api.activatePrompt(cfg.function_name, promptId);
      setCfg(updated);
      onSaved(updated);
      setSystemPrompt(updated.active_prompt?.system_prompt ?? "");
      setUserTemplate(updated.active_prompt?.user_template ?? "");
      setPromptDirty(false);
      loadHistory();
    } catch (e: any) {
      setPromptError(e.message);
    }
  };

  const variables = cfg.active_prompt?.variables ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="h6" fontWeight={700}>{cfg.display_name}</Typography>
        <Typography variant="body2" color="text.secondary">{cfg.description}</Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: "1px solid", borderColor: "divider" }}>
        <Tab icon={<CodeIcon fontSize="small" />} iconPosition="start" label="Prompt" sx={{ textTransform: "none", fontSize: 12, minHeight: 40 }} />
        <Tab icon={<TuneIcon fontSize="small" />} iconPosition="start" label="Parameters" sx={{ textTransform: "none", fontSize: 12, minHeight: 40 }} />
        <Tab icon={<HistoryIcon fontSize="small" />} iconPosition="start" label="History" sx={{ textTransform: "none", fontSize: 12, minHeight: 40 }} />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: "auto", p: 3 }}>

        {/* ── Prompt tab ── */}
        {tab === 0 && (
          <Stack gap={2}>
            {promptError && <Alert severity="error" onClose={() => setPromptError(null)}>{promptError}</Alert>}

            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                System Prompt
              </Typography>
              <TextField
                multiline minRows={5} maxRows={12}
                fullWidth size="small"
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); setPromptDirty(true); }}
                sx={{ mt: 0.5, fontFamily: "monospace", "& textarea": { fontFamily: "monospace", fontSize: 13 } }}
              />
            </Box>

            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                User Template
              </Typography>
              <TextField
                multiline minRows={6} maxRows={14}
                fullWidth size="small"
                value={userTemplate}
                onChange={(e) => { setUserTemplate(e.target.value); setPromptDirty(true); }}
                sx={{ mt: 0.5, "& textarea": { fontFamily: "monospace", fontSize: 13 } }}
              />
            </Box>

            {variables.length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Available variables
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={0.5} mt={0.5}>
                  {variables.map((v) => (
                    <Tooltip key={v.name} title={v.description} placement="top">
                      <Chip
                        label={`{${v.name}}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontFamily: "monospace", fontSize: 11 }}
                      />
                    </Tooltip>
                  ))}
                </Stack>
              </Box>
            )}

            {promptDirty && (
              <Stack gap={1}>
                <TextField
                  label="Version name (optional)"
                  placeholder={`${cfg.display_name} — edited`}
                  size="small"
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><AddIcon fontSize="small" /></InputAdornment>,
                  }}
                />
                <Button
                  variant="contained"
                  startIcon={promptSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                  onClick={savePrompt}
                  disabled={promptSaving}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {promptSaving ? "Saving…" : "Save as new version"}
                </Button>
              </Stack>
            )}
          </Stack>
        )}

        {/* ── Parameters tab ── */}
        {tab === 1 && (
          <Stack gap={3} maxWidth={480}>
            {paramsError && <Alert severity="error" onClose={() => setParamsError(null)}>{paramsError}</Alert>}

            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                Model
              </Typography>
              <TextField
                fullWidth size="small"
                placeholder={`global default: ${cfg.effective_model}`}
                value={model}
                onChange={(e) => { setModel(e.target.value); setParamsDirty(true); }}
                helperText='Leave blank to use the global LITELLM_MODEL setting. Examples: ollama/qwen2.5:3b · openai/gpt-4o-mini · anthropic/claude-haiku-4-5'
                sx={{ mt: 0.5 }}
              />
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Temperature
                </Typography>
                <Typography variant="caption" fontWeight={700}>{temperature.toFixed(2)}</Typography>
              </Stack>
              <Slider
                min={0} max={1} step={0.05}
                value={temperature}
                onChange={(_, v) => { setTemperature(v as number); setParamsDirty(true); }}
                sx={{ mt: 0.5 }}
              />
              <Typography variant="caption" color="text.disabled">
                Lower = more deterministic. Higher = more creative.
              </Typography>
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Max tokens
                </Typography>
                <Typography variant="caption" fontWeight={700}>{maxTokens}</Typography>
              </Stack>
              <Slider
                min={100} max={2000} step={50}
                value={maxTokens}
                onChange={(_, v) => { setMaxTokens(v as number); setParamsDirty(true); }}
                sx={{ mt: 0.5 }}
              />
            </Box>

            {paramsDirty && (
              <Button
                variant="contained"
                startIcon={paramsSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                onClick={saveParams}
                disabled={paramsSaving}
                sx={{ alignSelf: "flex-start" }}
              >
                {paramsSaving ? "Saving…" : "Save parameters"}
              </Button>
            )}
          </Stack>
        )}

        {/* ── History tab ── */}
        {tab === 2 && (
          <Box>
            {historyLoading && <CircularProgress size={20} />}
            {!historyLoading && history.length === 0 && (
              <Typography variant="body2" color="text.secondary">No prompt versions yet.</Typography>
            )}
            {history.map((p) => (
              <HistoryRow
                key={p.id}
                prompt={p}
                isActive={p.id === cfg.active_prompt_id}
                onActivate={() => activateHistoryPrompt(p.id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────
export function LLMConfigPage() {
  const [configs, setConfigs] = useState<LLMFunctionConfigOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFn, setSelectedFn] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfgs = await api.listLLMFunctions();
        setConfigs(cfgs);
        if (cfgs.length > 0) setSelectedFn(cfgs[0].function_name);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSaved = (updated: LLMFunctionConfigOut) => {
    setConfigs((prev) => prev.map((c) => c.function_name === updated.function_name ? updated : c));
  };

  const selected = configs.find((c) => c.function_name === selectedFn) ?? null;

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left: function list ── */}
      <Box sx={{
        width: 280, flexShrink: 0, borderRight: "1px solid", borderColor: "divider",
        overflowY: "auto", p: 2, bgcolor: "background.paper",
      }}>
        <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>LLM Functions</Typography>
        <Divider sx={{ my: 1 }} />

        {loading && <CircularProgress size={20} sx={{ mt: 1 }} />}
        {error && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{error}</Alert>}

        {configs.map((cfg) => (
          <FunctionCard
            key={cfg.function_name}
            cfg={cfg}
            selected={cfg.function_name === selectedFn}
            onClick={() => setSelectedFn(cfg.function_name)}
          />
        ))}

        {!loading && configs.length === 0 && !error && (
          <Alert severity="info" sx={{ fontSize: 12, mt: 1 }}>
            No functions found. Restart the backend to seed defaults.
          </Alert>
        )}
      </Box>

      {/* ── Right: editor ── */}
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        {selected ? (
          <FunctionEditor key={selected.function_name} cfg={selected} onSaved={handleSaved} />
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Typography color="text.disabled">Select a function to edit its prompt and parameters.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
