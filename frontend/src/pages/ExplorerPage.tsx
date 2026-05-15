/**
 * Explorer page — clustering scatter chart (Chart.js) with an auto-opening
 * cluster detail panel on the right.
 *
 * Click any point or cluster chip → right panel loads the pre-computed
 * centroid profile (z-scores vs overall population) instantly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip as ChartTooltip,
  Legend,
} from "chart.js";
import { Scatter } from "react-chartjs-2";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  Divider, FormControl, IconButton, InputLabel, MenuItem, Paper,
  Select, Slider, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseIcon from "@mui/icons-material/Close";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import { StreamingText } from "../components/StreamingText";
import {
  api,
  type Dataset, type FeatureGroup, type ClusteringRun,
  type Interpretation, type AlgorithmMeta,
} from "../api/client";
import { useAppCtx } from "../state/appContext";

// ─── Chart.js registration ────────────────────────────────────────────────────
ChartJS.register(LinearScale, PointElement, LineElement, ChartTooltip, Legend);

// ─── Colours ─────────────────────────────────────────────────────────────────
const PALETTE = [
  "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3",
  "#937860", "#DA8BC3", "#6EA6CC", "#CCB974", "#64B5CD",
  "#E377C2", "#BCBD22", "#17BECF", "#AEC7E8", "#FFBB78",
];
const clusterColor = (id: number) =>
  PALETTE[((id % PALETTE.length) + PALETTE.length) % PALETTE.length];

// ─── Types ────────────────────────────────────────────────────────────────────
interface DistFeature {
  column: string;
  cluster_mean: number;
  overall_mean: number;
  z_score: number;
}
interface ClusterProfile {
  cluster_id: number;
  size: number;
  total_population: number;
  centroid: Record<string, number>;
  distinguishing_features: DistFeature[];
}

// ─── Distinguishing feature bar ───────────────────────────────────────────────
function ZBar({ feat, maxZ }: { feat: DistFeature; maxZ: number }) {
  const abs = Math.abs(feat.z_score);
  const pct = maxZ > 0 ? (abs / maxZ) * 100 : 0;
  const isPos = feat.z_score >= 0;
  const color = isPos ? "#2e7d32" : "#c62828";
  const Icon = isPos ? TrendingUpIcon : TrendingDownIcon;

  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ py: 0.4 }}>
      <Icon sx={{ fontSize: 14, color, flexShrink: 0 }} />
      <Tooltip
        title={`Cluster mean: ${feat.cluster_mean.toFixed(3)}  |  Overall: ${feat.overall_mean.toFixed(3)}  |  z = ${feat.z_score.toFixed(2)}`}
        placement="left"
      >
        <Typography
          variant="caption"
          sx={{ minWidth: 110, fontFamily: "monospace", cursor: "default", fontSize: 11 }}
        >
          {feat.column}
        </Typography>
      </Tooltip>
      <Box sx={{ flex: 1, height: 8, bgcolor: "grey.100", borderRadius: 4, overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: color, borderRadius: 4 }} />
      </Box>
      <Typography variant="caption" sx={{ minWidth: 40, textAlign: "right", color, fontWeight: 700, fontSize: 10 }}>
        {isPos ? "+" : ""}{feat.z_score.toFixed(2)}σ
      </Typography>
    </Stack>
  );
}

// ─── Cluster detail panel ─────────────────────────────────────────────────────
function ClusterPanel({
  run,
  clusterId,
  onClose,
}: {
  run: ClusteringRun;
  clusterId: number;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<ClusterProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [rightTab, setRightTab] = useState(0);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [structuredLoading, setStructuredLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-load profile when cluster/run changes
  useEffect(() => {
    setProfile(null);
    setProfileLoading(true);
    setError(null);
    api.clusterProfile(run.id, clusterId)
      .then((p) => setProfile(p as unknown as ClusterProfile))
      .catch((e) => setError(e.message))
      .finally(() => setProfileLoading(false));

    // Clear interpretation from previous cluster
    setInterpretation(null);
    setStreamText("");
  }, [run.id, clusterId]);

  const handleStream = async () => {
    setStreaming(true);
    setStreamText("");
    setRightTab(0);
    try {
      await api.streamInterpret(run.id, clusterId,
        (tok) => setStreamText((p) => p + tok),
        (err) => setError(err),
      );
    } finally { setStreaming(false); }
  };

  const handleStructured = async () => {
    setStructuredLoading(true);
    setRightTab(1);
    try {
      setInterpretation(await api.interpret(run.id, clusterId, true));
    } catch (e: any) { setError(e.message); }
    finally { setStructuredLoading(false); }
  };

  const size = run.result.cluster_sizes[clusterId] ?? 0;
  const pct = ((size / (run.result.n_rows ?? 1)) * 100).toFixed(1);
  const maxZ = profile
    ? Math.max(...profile.distinguishing_features.map((f) => Math.abs(f.z_score)), 0.01)
    : 1;

  return (
    <Box sx={{
      width: 380, flexShrink: 0, borderLeft: "1px solid",
      borderColor: "divider", bgcolor: "background.paper",
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      {/* Header */}
      <Box sx={{
        px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider",
        bgcolor: "grey.50",
      }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: clusterColor(clusterId), flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
            Cluster {clusterId}
          </Typography>
          <Chip label={`${size.toLocaleString()} members`} size="small" />
          <Chip label={`${pct}%`} size="small" variant="outlined" />
          <Tooltip title="Close panel">
            <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Profile section */}
      <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Distinguishing features
        </Typography>
        {profileLoading && <CircularProgress size={16} sx={{ mt: 1 }} />}
        {error && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{error}</Alert>}
        {profile && !profileLoading && (
          <Box sx={{ mt: 1 }}>
            {profile.distinguishing_features.length === 0 && (
              <Typography variant="caption" color="text.disabled">No distinguishing features found.</Typography>
            )}
            {profile.distinguishing_features.map((f) => (
              <ZBar key={f.column} feat={f} maxZ={maxZ} />
            ))}
            <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block", fontSize: 10 }}>
              σ = standard deviations from overall population mean
            </Typography>
          </Box>
        )}
      </Box>

      {/* Centroid table (collapsible via scrollable area) */}
      {profile && (
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider", maxHeight: 180, overflowY: "auto" }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>Centroid values</Typography>
          <Stack gap={0.3} sx={{ mt: 0.5 }}>
            {Object.entries(profile.centroid).map(([col, val]) => (
              <Stack key={col} direction="row" justifyContent="space-between">
                <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{col}</Typography>
                <Typography variant="caption" fontWeight={600}>{val.toFixed(3)}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {/* LLM interpretation */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Tooltip title="Stream a live narrative from the LLM">
            <span>
              <Button
                size="small" variant="contained"
                startIcon={streaming ? <CircularProgress size={12} color="inherit" /> : <AutoFixHighIcon />}
                onClick={handleStream}
                disabled={streaming}
              >
                {streaming ? "Narrating…" : "Narrate"}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Refresh the structured JSON interpretation">
            <span>
              <Button
                size="small" variant="outlined"
                startIcon={structuredLoading ? <CircularProgress size={12} /> : <PlayArrowIcon />}
                onClick={handleStructured}
                disabled={structuredLoading}
              >
                Structured
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      <Tabs value={rightTab} onChange={(_, v) => setRightTab(v)} sx={{ px: 2, minHeight: 32, borderBottom: "1px solid", borderColor: "divider" }}>
        <Tab label="Narrative" sx={{ minHeight: 32, textTransform: "none", fontSize: 11 }} />
        <Tab label="Structured" sx={{ minHeight: 32, textTransform: "none", fontSize: 11 }} />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        {rightTab === 0 && (
          <StreamingText
            text={streamText}
            streaming={streaming}
            placeholder="Click 'Narrate' to stream a live interpretation."
          />
        )}
        {rightTab === 1 && (
          <>
            {structuredLoading && <CircularProgress size={20} />}
            {interpretation && (
              <Box>
                <Stack direction="row" gap={1} mb={1} alignItems="center">
                  <Chip
                    label={interpretation.confidence}
                    size="small"
                    color={
                      interpretation.confidence === "high" ? "success"
                      : interpretation.confidence === "low" ? "error" : "warning"
                    }
                  />
                  <Typography variant="caption" color="text.disabled">
                    {interpretation.model_used}
                  </Typography>
                </Stack>
                <Typography variant="subtitle2" fontWeight={700} mb={1}>
                  {interpretation.headline}
                </Typography>
                <Box component="ul" sx={{ pl: 2, m: 0 }}>
                  {interpretation.characteristics.map((c, i) => (
                    <Box component="li" key={i}>
                      <Typography variant="body2" sx={{ fontSize: 13 }}>{c}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            {!interpretation && !structuredLoading && (
              <Typography variant="caption" color="text.disabled" sx={{ fontStyle: "italic" }}>
                Click 'Structured' for a cached JSON interpretation.
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type AlgoParams = Record<string, number | string>;

export function ExplorerPage() {
  const { activeSpace } = useAppCtx();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [groups, setGroups] = useState<FeatureGroup[]>([]);
  const [algorithms, setAlgorithms] = useState<AlgorithmMeta[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [algorithm, setAlgorithm] = useState("kmeans");
  const [algoParams, setAlgoParams] = useState<AlgoParams>({ n_clusters: 3 });
  const [run, setRun] = useState<ClusteringRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

  const chartRef = useRef<ChartJS<"scatter"> | null>(null);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [dsList, algos] = await Promise.all([api.listDatasets(), api.listAlgorithms()]);
        setAlgorithms(algos);
        const ds =
          (activeSpace?.primary_table
            ? dsList.find((d) => d.duckdb_table === activeSpace.primary_table)
            : null) ??
          (activeSpace
            ? dsList.find((d) => d.source_id === activeSpace.source_id)
            : null) ??
          dsList[0];
        setRun(null);
        setSelectedCluster(null);
        setGroups([]);
        setWeights({});
        if (!ds) {
          setDataset(null);
          return;
        }
        setDataset(ds);
        const gs = await api.listFeatureGroups(ds.id);
        setGroups(gs);
        setWeights(Object.fromEntries(gs.map((g) => [g.name, g.default_weight])));
      } catch (e: any) { setError(e.message); }
    })();
  }, [activeSpace?.id, activeSpace?.primary_table, activeSpace?.source_id]);

  // Sync algorithm params when algorithm changes
  useEffect(() => {
    const meta = algorithms.find((a) => a.name === algorithm);
    if (!meta) return;
    const defaults: AlgoParams = {};
    Object.entries(meta.params).forEach(([k, v]) => { defaults[k] = v.default as number | string; });
    setAlgoParams(defaults);
  }, [algorithm, algorithms]);

  const triggerClustering = useCallback(async () => {
    if (!dataset) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.runClustering({
        dataset_id: dataset.id,
        algorithm,
        algorithm_params: algoParams as Record<string, unknown>,
        feature_weights: weights,
      });
      setRun(r);
      setSelectedCluster(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }, [dataset, algorithm, algoParams, weights]);

  // Debounced auto-cluster
  useEffect(() => {
    if (!dataset || groups.length === 0) return;
    const h = setTimeout(triggerClustering, 450);
    return () => clearTimeout(h);
  }, [dataset, groups.length, weights, algorithm, JSON.stringify(algoParams), triggerClustering]);

  // ── Chart.js data ─────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!run) return { datasets: [] };
    const { coords, labels } = run.result;
    const unique = Array.from(new Set(labels)).sort((a, b) => a - b);

    return {
      datasets: unique.map((c) => {
        const pts: { x: number; y: number }[] = [];
        labels.forEach((l, i) => { if (l === c) pts.push({ x: coords[i][0], y: coords[i][1] }); });
        const color = clusterColor(c);
        const isSelected = selectedCluster === c;
        return {
          label: c === -1 ? "Noise" : `Cluster ${c}`,
          data: pts,
          backgroundColor: color + (selectedCluster !== null && !isSelected ? "40" : "cc"),
          pointRadius: isSelected ? 6 : 4,
          pointHoverRadius: 8,
          pointBorderWidth: isSelected ? 2 : 0,
          pointBorderColor: isSelected ? "#ffffff" : "transparent",
        };
      }),
    };
  }, [run, selectedCluster]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 } as const,
    plugins: {
      legend: {
        display: false, // we render our own cluster chips below
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const dsLabel = ctx.dataset.label ?? "";
            return `${dsLabel}  (${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})`;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "PC1", font: { size: 11 } },
        grid: { color: "#eeeeee" },
        ticks: { font: { size: 10 } },
      },
      y: {
        title: { display: true, text: "PC2", font: { size: 11 } },
        grid: { color: "#eeeeee" },
        ticks: { font: { size: 10 } },
      },
    },
    onClick: (_event: any, elements: any[]) => {
      if (elements.length === 0) return;
      const dsIdx = elements[0].datasetIndex;
      const label = chartData.datasets[dsIdx]?.label ?? "";
      if (label.startsWith("Cluster ")) {
        const id = parseInt(label.split(" ")[1]);
        setSelectedCluster((prev) => (prev === id ? null : id));
      }
    },
  }), [chartData]);

  const algoMeta = algorithms.find((a) => a.name === algorithm);

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left sidebar: controls ─────────────────────────────────────────── */}
      <Box sx={{
        width: 264, borderRight: "1px solid", borderColor: "divider",
        overflowY: "auto", p: 2, bgcolor: "background.paper", flexShrink: 0,
      }}>
        {activeSpace && (
          <Box sx={{ mb: 1.5, p: 1, bgcolor: "primary.50", borderRadius: 2, border: "1px solid", borderColor: "primary.200" }}>
            <Typography variant="caption" fontWeight={700} color="primary.main">Space</Typography>
            <Typography variant="body2" fontWeight={600}>{activeSpace.display_name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {activeSpace.tables.length} tables · entity: {activeSpace.primary_table ?? "—"}
            </Typography>
          </Box>
        )}

        {/* Algorithm selector */}
        <Typography variant="overline" color="text.secondary">Algorithm</Typography>
        <Tooltip title={algoMeta?.description ?? ""} placement="right" arrow>
          <FormControl fullWidth size="small" sx={{ mt: 0.5, mb: 2 }}>
            <Select
              value={algorithms.some((a) => a.name === algorithm) ? algorithm : ""}
              onChange={(e) => setAlgorithm(e.target.value)}
            >
              {algorithms.map((a) => (
                <MenuItem key={a.name} value={a.name}>
                  <Tooltip title={a.description} placement="right">
                    <span>{a.display_name}</span>
                  </Tooltip>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Tooltip>

        {/* Algorithm params */}
        {algoMeta && Object.entries(algoMeta.params).map(([key, spec]) => (
          <Box key={key} mb={1.5}>
            <Stack direction="row" justifyContent="space-between">
              <Tooltip title={`Parameter: ${key}`} placement="right">
                <Typography variant="caption" color="text.secondary">{spec.label}</Typography>
              </Tooltip>
              <Typography variant="caption" fontWeight={700}>
                {algoParams[key] ?? spec.default}
              </Typography>
            </Stack>
            {spec.type === "str" && spec.options ? (
              <FormControl fullWidth size="small" sx={{ mt: 0.5 }}>
                <Select
                  value={String(algoParams[key] ?? spec.default)}
                  onChange={(e) => setAlgoParams({ ...algoParams, [key]: e.target.value })}
                >
                  {spec.options.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </Select>
              </FormControl>
            ) : (
              <Slider
                size="small"
                min={spec.min ?? 0} max={spec.max ?? 20} step={spec.step ?? 1}
                value={Number(algoParams[key] ?? spec.default)}
                onChange={(_, v) => setAlgoParams({ ...algoParams, [key]: v as number })}
              />
            )}
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />

        {/* Feature weights */}
        <Typography variant="overline" color="text.secondary">Feature weights</Typography>
        {groups.length === 0 && (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
            No feature groups. Go to Sources → configure groups.
          </Typography>
        )}
        {groups.map((g) => (
          <Tooltip key={g.id} title={`Columns: ${g.columns.join(", ")}`} placement="right" arrow>
            <Box mt={1}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption">{g.name}</Typography>
                <Typography variant="caption" fontWeight={700}>{(weights[g.name] ?? 1).toFixed(2)}</Typography>
              </Stack>
              <Slider
                size="small" min={0} max={3} step={0.05}
                value={weights[g.name] ?? 1}
                onChange={(_, v) => setWeights({ ...weights, [g.name]: v as number })}
              />
            </Box>
          </Tooltip>
        ))}

        {run && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary">Run stats</Typography>
            <Stack gap={0.5} mt={0.5}>
              {[
                ["silhouette", run.silhouette?.toFixed(3) ?? "—"],
                ["clusters",   run.n_clusters],
                ["rows",       run.result.n_rows?.toLocaleString()],
                ["PCA var.",   run.result.pca_variance ? `${(run.result.pca_variance.reduce((a, b) => a + b, 0) * 100).toFixed(0)}%` : "—"],
              ].map(([label, value]) => (
                <Stack key={label as string} direction="row" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="caption" fontWeight={600}>{value}</Typography>
                </Stack>
              ))}
              {run.mlflow_run_id && (
                <Tooltip title={`Full MLflow run ID: ${run.mlflow_run_id}`} placement="right">
                  <Typography variant="caption" color="text.disabled" noWrap>
                    mlflow: {run.mlflow_run_id.slice(0, 10)}…
                  </Typography>
                </Tooltip>
              )}
            </Stack>
          </>
        )}
      </Box>

      {/* ── Main: chart ────────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Header bar */}
        <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              {dataset ? `${dataset.name} · ${dataset.row_count?.toLocaleString()} rows` : "loading…"}
            </Typography>
            {busy && <><CircularProgress size={14} /><Typography variant="caption" color="primary">clustering…</Typography></>}
            {run && !busy && (
              <Chip label={`${run.algorithm} · ${run.n_clusters} clusters`} size="small" color="primary" variant="outlined" />
            )}
            <Box flex={1} />
            <Tooltip title="Re-run clustering with current settings">
              <IconButton size="small" onClick={triggerClustering} disabled={busy}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 0.5 }} onClose={() => setError(null)}>{error}</Alert>}
        </Box>

        {/* Chart.js scatter */}
        <Box sx={{ flex: 1, position: "relative", overflow: "hidden", p: 1, bgcolor: "#fafafa" }}>
          {run ? (
            <Scatter
              ref={chartRef as any}
              data={chartData}
              options={chartOptions as any}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 1 }}>
              <CircularProgress />
              <Typography color="text.secondary" variant="body2">Running initial clustering…</Typography>
            </Box>
          )}
        </Box>

        {/* Cluster chip legend */}
        {run && (
          <Box sx={{
            px: 2, py: 1, borderTop: "1px solid", borderColor: "divider",
            bgcolor: "background.paper", overflowX: "auto",
          }}>
            <Stack direction="row" gap={0.75} flexWrap="nowrap" alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Click to inspect →
              </Typography>
              {Object.entries(run.result.cluster_sizes)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([cid, sz]) => {
                  const id = Number(cid);
                  const isSelected = selectedCluster === id;
                  return (
                    <Tooltip key={cid} title={`${sz} members · click to inspect`} placement="top">
                      <Chip
                        label={`C${cid}: ${sz}`}
                        size="small"
                        onClick={() => setSelectedCluster(isSelected ? null : id)}
                        sx={{
                          bgcolor: clusterColor(id),
                          color: "white",
                          fontWeight: 700,
                          fontSize: 11,
                          opacity: selectedCluster !== null && !isSelected ? 0.35 : 1,
                          outline: isSelected ? "2px solid #fff" : "none",
                          outlineOffset: 1,
                          transition: "opacity 0.15s, outline 0.15s",
                          cursor: "pointer",
                          "&:hover": { opacity: 1 },
                        }}
                      />
                    </Tooltip>
                  );
                })}
            </Stack>
          </Box>
        )}
      </Box>

      {/* ── Right: cluster detail panel ────────────────────────────────────── */}
      {selectedCluster !== null && run ? (
        <ClusterPanel
          run={run}
          clusterId={selectedCluster}
          onClose={() => setSelectedCluster(null)}
        />
      ) : (
        <Box sx={{
          width: 240, borderLeft: "1px solid", borderColor: "divider",
          bgcolor: "background.paper", display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
        }}>
          <Box sx={{ textAlign: "center", p: 3 }}>
            <BubbleChartIcon sx={{ fontSize: 36, color: "grey.300", mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Click a cluster chip or any point to inspect it
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Fix missing import in placeholder
function BubbleChartIcon({ sx }: { sx: any }) {
  return (
    <Box component="span" sx={{ ...sx, display: "block", "& svg": { display: "block" } }}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
        <path d="M7 10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm10-11c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm-5 7c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
      </svg>
    </Box>
  );
}
