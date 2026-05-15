/**
 * Step 5 — ML Tools Configuration
 *
 * Mode A — Exploration: algorithm + hyper-parameter selection (feeds the
 *   existing Explorer/clustering pipeline).
 *
 * Mode B — Prediction: user selects target table/column + model type.
 *   The system uses EDA-inferred semantic types to propose feature encodings.
 *   Training schema is logged to MLflow as a pyfunc artifact.
 */
import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Chip, Alert, Button, Card, CardContent,
  ToggleButtonGroup, ToggleButton, MenuItem, TextField, Slider,
  Select, FormControl, InputLabel, Divider, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, FormControlLabel,
  Switch, Tooltip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import SaveIcon from "@mui/icons-material/Save";
import BuildIcon from "@mui/icons-material/Build";
import { api, type MLConfigIn, type ColumnAnnotation } from "../../api/client";
import { useWizard } from "./ConfigWizard";

// ── Algorithms (mirrors backend REGISTRY) ─────────────────────────────────────

const ALGORITHMS = [
  {
    name: "kmeans", label: "K-Means",
    desc: "Centroid-based. Best for roughly spherical, equal-sized clusters.",
    params: [{ key: "n_clusters", label: "Number of clusters", type: "int", min: 2, max: 12, step: 1, default: 3 }],
  },
  {
    name: "dbscan", label: "DBSCAN",
    desc: "Density-based. Discovers arbitrary shapes; marks outliers as -1.",
    params: [
      { key: "eps", label: "Epsilon (radius)", type: "float", min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: "min_samples", label: "Min samples", type: "int", min: 1, max: 50, step: 1, default: 5 },
    ],
  },
  {
    name: "agglomerative", label: "Agglomerative",
    desc: "Hierarchical bottom-up clustering. Good for nested structure.",
    params: [
      { key: "n_clusters", label: "Number of clusters", type: "int", min: 2, max: 12, step: 1, default: 3 },
    ],
  },
  {
    name: "gmm", label: "Gaussian Mixture",
    desc: "Soft probabilistic clusters. Good when clusters overlap.",
    params: [
      { key: "n_components", label: "Components", type: "int", min: 2, max: 12, step: 1, default: 3 },
    ],
  },
];

const MODEL_TYPES = [
  { value: "classification", label: "Classification", desc: "Predict a discrete label (category/boolean target)" },
  { value: "regression",     label: "Regression",     desc: "Predict a continuous numeric value" },
  { value: "time_series",    label: "Time Series",    desc: "Predict future values in a temporal sequence" },
];

const ENCODING_OPTIONS = ["passthrough", "standard_scale", "onehot", "ordinal", "tfidf", "date_extract", "drop"];

// ── Exploration sub-panel ─────────────────────────────────────────────────────

function ExplorationPanel({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const algo = (config.algorithm as string) ?? "kmeans";
  const params = (config.algorithm_params as Record<string, unknown>) ?? {};
  const algoDef = ALGORITHMS.find((a) => a.name === algo)!;

  const setAlgo = (name: string) => {
    const def = ALGORITHMS.find((a) => a.name === name);
    const defaultParams = Object.fromEntries(def?.params.map((p) => [p.key, p.default]) ?? []);
    onChange({ ...config, algorithm: name, algorithm_params: defaultParams });
  };

  const setParam = (key: string, value: number) => {
    onChange({ ...config, algorithm_params: { ...params, [key]: value } });
  };

  return (
    <Stack gap={2}>
      <Typography variant="subtitle2">Clustering Algorithm</Typography>
      <Stack gap={1}>
        {ALGORITHMS.map((a) => (
          <Card
            key={a.name}
            onClick={() => setAlgo(a.name)}
            sx={{
              cursor: "pointer",
              border: "2px solid",
              borderColor: algo === a.name ? "primary.main" : "transparent",
              transition: "border-color 0.15s",
            }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700}>{a.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{a.desc}</Typography>
                </Box>
                {algo === a.name && <Chip label="selected" size="small" color="primary" />}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {algoDef?.params.length > 0 && (
        <>
          <Divider />
          <Typography variant="subtitle2">Parameters</Typography>
          {algoDef.params.map((p) => (
            <Box key={p.key}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2">{p.label}</Typography>
                <Typography variant="body2" fontWeight={700}>
                  {(params[p.key] as number) ?? p.default}
                </Typography>
              </Stack>
              <Slider
                value={(params[p.key] as number) ?? p.default}
                min={p.min} max={p.max} step={p.step}
                onChange={(_, v) => setParam(p.key, v as number)}
                size="small"
                sx={{ mt: 0.5 }}
              />
            </Box>
          ))}
        </>
      )}
    </Stack>
  );
}

// ── Prediction sub-panel ──────────────────────────────────────────────────────

function PredictionPanel({
  sourceId,
  selectedTables,
  config,
  onChange,
  onBuildSchema,
  building,
  schemaBuilt,
}: {
  sourceId: string;
  selectedTables: string[];
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  onBuildSchema: () => void;
  building: boolean;
  schemaBuilt: boolean;
}) {
  const [annotations, setAnnotations] = useState<ColumnAnnotation[]>([]);
  const [loadingAnns, setLoadingAnns] = useState(false);

  useEffect(() => {
    setLoadingAnns(true);
    api.getEDA(sourceId)
      .then(setAnnotations)
      .catch(() => {})
      .finally(() => setLoadingAnns(false));
  }, [sourceId]);

  const targetTable = (config.target_table as string) ?? "";
  const targetCol = (config.target_column as string) ?? "";
  const modelType = (config.model_type as string) ?? "classification";
  const trainRatio = (config.train_ratio as number) ?? 0.8;
  const overrides = (config.user_overrides as Record<string, string>) ?? {};

  const tableAnnotations = annotations.filter((a) => a.table_name === targetTable);
  const allAnnotations = annotations.filter((a) => !(a.table_name === targetTable && a.column_name === targetCol));

  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const setOverride = (colKey: string, enc: string) =>
    set("user_overrides", { ...overrides, [colKey]: enc });

  if (loadingAnns) return <LinearProgress />;

  return (
    <Stack gap={2}>
      <Typography variant="subtitle2">Target Variable</Typography>
      <Stack direction="row" gap={1}>
        <FormControl size="small" fullWidth>
          <InputLabel>Table</InputLabel>
          <Select
            label="Table"
            value={targetTable}
            onChange={(e) => { set("target_table", e.target.value); set("target_column", ""); }}
          >
            {selectedTables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel>Column (target)</InputLabel>
          <Select
            label="Column (target)"
            value={targetCol}
            onChange={(e) => set("target_column", e.target.value)}
            disabled={!targetTable}
          >
            {tableAnnotations.map((a) => (
              <MenuItem key={a.column_name} value={a.column_name}>
                {a.column_name}
                <Chip
                  label={a.user_semantic_type ?? a.semantic_type}
                  size="small"
                  sx={{ ml: 1, fontSize: 10 }}
                />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Divider />
      <Typography variant="subtitle2">Task Type</Typography>
      <Stack gap={1}>
        {MODEL_TYPES.map((mt) => (
          <Card
            key={mt.value}
            onClick={() => set("model_type", mt.value)}
            sx={{
              cursor: "pointer", border: "2px solid",
              borderColor: modelType === mt.value ? "secondary.main" : "transparent",
              transition: "border-color 0.15s",
            }}
          >
            <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700}>{mt.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{mt.desc}</Typography>
                </Box>
                {modelType === mt.value && <Chip label="selected" size="small" color="secondary" />}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">Train / Test split</Typography>
        <Typography variant="body2" fontWeight={700}>{Math.round(trainRatio * 100)}% / {Math.round((1 - trainRatio) * 100)}%</Typography>
      </Stack>
      <Slider
        value={trainRatio}
        min={0.5} max={0.95} step={0.05}
        onChange={(_, v) => set("train_ratio", v as number)}
        size="small"
        marks={[{ value: 0.7, label: "70%" }, { value: 0.8, label: "80%" }]}
      />

      {allAnnotations.length > 0 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              Feature encodings
              <Chip label={`${allAnnotations.length} features`} size="small" sx={{ ml: 1 }} />
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack gap={1}>
              {allAnnotations.map((a) => {
                const colKey = selectedTables.length > 1
                  ? `${a.table_name}.${a.column_name}`
                  : a.column_name;
                const auto = a.user_semantic_type ?? a.semantic_type;
                const enc = overrides[colKey] ?? undefined;
                return (
                  <Stack key={colKey} direction="row" alignItems="center" gap={1}>
                    <Typography variant="caption" sx={{ fontFamily: "monospace", flex: 1, minWidth: 0 }} noWrap>
                      {colKey}
                    </Typography>
                    <Chip label={auto} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <Select
                        value={enc ?? "auto"}
                        onChange={(e) => e.target.value === "auto"
                          ? setOverride(colKey, "")
                          : setOverride(colKey, e.target.value)
                        }
                        displayEmpty
                        sx={{ fontSize: 11, height: 28 }}
                      >
                        <MenuItem value="auto"><em>Auto</em></MenuItem>
                        {ENCODING_OPTIONS.map((o) => (
                          <MenuItem key={o} value={o} sx={{ fontSize: 11 }}>{o}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                );
              })}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      <Button
        variant="contained"
        color="secondary"
        startIcon={<BuildIcon />}
        onClick={onBuildSchema}
        disabled={building || !targetTable || !targetCol}
        sx={{ alignSelf: "flex-start" }}
      >
        {building ? "Building schema…" : schemaBuilt ? "Rebuild schema" : "Build training schema"}
      </Button>
      {schemaBuilt && (
        <Alert severity="success" sx={{ fontSize: 12 }}>
          Training schema built and logged to MLflow.
        </Alert>
      )}
    </Stack>
  );
}

// ── Main step component ───────────────────────────────────────────────────────

export function MLConfigStep() {
  const { activeSpace, selectedTables, mlDone, setMlDone } = useWizard();
  const [mode, setMode] = useState<"exploration" | "prediction">("exploration");
  const [explorationConfig, setExplorationConfig] = useState<Record<string, unknown>>({
    algorithm: "kmeans",
    algorithm_params: { n_clusters: 3 },
  });
  const [predictionConfig, setPredictionConfig] = useState<Record<string, unknown>>({
    model_type: "classification",
    train_ratio: 0.8,
    user_overrides: {},
  });
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [schemaBuilt, setSchemaBuilt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!activeSpace) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveMLConfig({
        source_id: activeSpace.source_id,
        mode,
        exploration_config: explorationConfig,
        prediction_config: predictionConfig,
      });
      setMlDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBuildSchema = async () => {
    if (!activeSpace) return;
    setBuilding(true);
    setError(null);
    try {
      await api.buildTrainingSchema({
        source_id: activeSpace.source_id,
        target_table: predictionConfig.target_table as string,
        target_column: predictionConfig.target_column as string,
        model_type: predictionConfig.model_type as any,
        train_ratio: predictionConfig.train_ratio as number,
        user_overrides: predictionConfig.user_overrides as Record<string, string>,
      });
      setSchemaBuilt(true);
      setMlDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  };

  if (!activeSpace) return <Alert severity="warning">Complete Step 1 first.</Alert>;

  return (
    <Box>
      <Typography variant="h5" gutterBottom>ML Tools Configuration</Typography>
      <Typography color="text.secondary" sx={{ fontSize: 14, mb: 3 }}>
        Choose how Semantic Explorer will work with your data.
        Exploration stays fully LLM-driven. Prediction uses the training schema you define here.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Mode toggle */}
      <ToggleButtonGroup
        value={mode}
        exclusive
        onChange={(_, v) => v && setMode(v)}
        size="small"
        sx={{ mb: 3 }}
      >
        <ToggleButton value="exploration" sx={{ gap: 0.5, px: 2 }}>
          <BubbleChartIcon fontSize="small" />
          <Typography variant="body2" fontWeight={600}>Exploration</Typography>
        </ToggleButton>
        <ToggleButton value="prediction" sx={{ gap: 0.5, px: 2 }}>
          <PrecisionManufacturingIcon fontSize="small" />
          <Typography variant="body2" fontWeight={600}>Prediction</Typography>
        </ToggleButton>
      </ToggleButtonGroup>

      {/* Mode description */}
      {mode === "exploration" ? (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          <strong>Exploration mode:</strong> Uses clustering algorithms to discover natural groupings
          in your data. LLM interprets the clusters. Select an algorithm and its parameters below.
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          <strong>Prediction mode:</strong> Prepares a supervised ML training schema.
          Define your target variable and the system will infer feature encodings from the EDA results.
          The schema is logged to MLflow as a reproducible pyfunc artifact.
        </Alert>
      )}

      <Card>
        <CardContent>
          {mode === "exploration" ? (
            <ExplorationPanel config={explorationConfig} onChange={setExplorationConfig} />
          ) : (
            <PredictionPanel
              sourceId={activeSpace.source_id}
              selectedTables={selectedTables}
              config={predictionConfig}
              onChange={setPredictionConfig}
              onBuildSchema={handleBuildSchema}
              building={building}
              schemaBuilt={schemaBuilt}
            />
          )}
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save configuration"}
        </Button>
      </Stack>

      {mlDone && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Configuration saved. Switch to <strong>Explore</strong> mode to start analysing your data.
        </Alert>
      )}
    </Box>
  );
}
