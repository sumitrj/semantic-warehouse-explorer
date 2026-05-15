/**
 * Step 3 — EDA (Exploratory Data Analysis)
 *
 * Runs column-level statistical analysis on selected tables (no LLM).
 * Shows semantic type badges, null%, distinct%, and mini distribution bars.
 * Users can override detected semantic types.
 */
import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Chip, Alert, CircularProgress,
  Button, Card, CardContent, Accordion, AccordionSummary,
  AccordionDetails, LinearProgress, MenuItem, Select,
  Tooltip, Badge, Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import EditIcon from "@mui/icons-material/Edit";
import { api, type ColumnAnnotation } from "../../api/client";
import { useWizard } from "./ConfigWizard";

const SEMANTIC_TYPES = ["id", "category", "numeric", "date", "boolean", "text"] as const;
type SemanticType = (typeof SEMANTIC_TYPES)[number];

const TYPE_COLOR: Record<SemanticType, "default" | "primary" | "secondary" | "success" | "warning" | "error"> = {
  id: "default",
  category: "primary",
  numeric: "secondary",
  date: "warning",
  boolean: "success",
  text: "error",
};

const TYPE_LABELS: Record<SemanticType, string> = {
  id: "ID / Key",
  category: "Category",
  numeric: "Numeric",
  date: "Date / Time",
  boolean: "Boolean",
  text: "Free Text",
};

function NullBar({ pct }: { pct: number }) {
  return (
    <Tooltip title={`${pct.toFixed(1)}% null`}>
      <Box sx={{ width: 60, bgcolor: "grey.100", borderRadius: 4, overflow: "hidden", height: 6 }}>
        <Box
          sx={{
            width: `${Math.min(pct, 100)}%`,
            height: "100%",
            bgcolor: pct > 20 ? "error.light" : pct > 5 ? "warning.light" : "success.light",
          }}
        />
      </Box>
    </Tooltip>
  );
}

function DistBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
      <Box sx={{ width: 80, bgcolor: "grey.100", borderRadius: 4, overflow: "hidden", height: 10 }}>
        <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: "primary.light" }} />
      </Box>
      <Typography variant="caption" noWrap sx={{ maxWidth: 90, fontFamily: "monospace" }}>
        {label}
      </Typography>
    </Stack>
  );
}

function ColumnCard({
  ann,
  sourceId,
  onOverride,
}: {
  ann: ColumnAnnotation;
  sourceId: string;
  onOverride: (col: string, table: string, st: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>(ann.user_semantic_type ?? ann.semantic_type);
  const [saving, setSaving] = useState(false);

  const effectiveType = (ann.user_semantic_type ?? ann.semantic_type) as SemanticType;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.overrideSemanticType(sourceId, ann.table_name, ann.column_name, selected);
      onOverride(ann.column_name, ann.table_name, selected);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const topVals = ann.stats.top_values ?? [];
  const maxCount = topVals[0]?.count ?? 1;

  return (
    <Card sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
          {/* Column name */}
          <Typography
            variant="body2"
            fontWeight={700}
            sx={{ fontFamily: "monospace", minWidth: 140, flex: "0 0 auto" }}
          >
            {ann.column_name}
          </Typography>

          {/* DType */}
          <Chip
            label={ann.dtype}
            size="small"
            variant="outlined"
            sx={{ fontSize: 10, fontFamily: "monospace" }}
          />

          {/* Semantic type badge */}
          {editing ? (
            <Stack direction="row" alignItems="center" gap={0.5}>
              <Select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                size="small"
                sx={{ fontSize: 11, height: 26 }}
              >
                {SEMANTIC_TYPES.map((t) => (
                  <MenuItem key={t} value={t} sx={{ fontSize: 11 }}>
                    {TYPE_LABELS[t]}
                  </MenuItem>
                ))}
              </Select>
              <Button size="small" onClick={handleSave} disabled={saving} sx={{ minWidth: 0, px: 1 }}>
                {saving ? "…" : "OK"}
              </Button>
              <Button size="small" onClick={() => setEditing(false)} color="inherit" sx={{ minWidth: 0, px: 1 }}>
                ✕
              </Button>
            </Stack>
          ) : (
            <Tooltip title={ann.user_semantic_type ? "User override" : "Auto-detected"}>
              <Badge
                badgeContent={ann.user_semantic_type ? "✎" : undefined}
                color="warning"
                sx={{ cursor: "pointer" }}
                onClick={() => setEditing(true)}
              >
                <Chip
                  label={TYPE_LABELS[effectiveType] ?? effectiveType}
                  size="small"
                  color={TYPE_COLOR[effectiveType] ?? "default"}
                  icon={<EditIcon sx={{ fontSize: "12px !important" }} />}
                />
              </Badge>
            </Tooltip>
          )}

          {/* Null bar */}
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Typography variant="caption" color="text.secondary">null</Typography>
            <NullBar pct={ann.null_pct} />
            <Typography variant="caption" color="text.secondary">{ann.null_pct.toFixed(1)}%</Typography>
          </Stack>

          {/* Distinct */}
          <Typography variant="caption" color="text.secondary">
            {ann.distinct_count.toLocaleString()} distinct ({ann.distinct_pct.toFixed(1)}%)
          </Typography>

          {/* Numeric range */}
          {ann.stats.min !== undefined && (
            <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
              [{ann.stats.min?.toFixed(2)} – {ann.stats.max?.toFixed(2)}]
              {" "}μ={ann.stats.mean?.toFixed(2)}
            </Typography>
          )}
        </Stack>

        {/* Top values distribution */}
        {topVals.length > 0 && (
          <Box sx={{ mt: 1.5, pl: 1, borderLeft: "3px solid #e0e0e0" }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              Top values
            </Typography>
            <Stack gap={0.4}>
              {topVals.slice(0, 8).map((tv) => (
                <DistBar key={tv.value} value={tv.count} max={maxCount} label={`${tv.value} (${tv.pct}%)`} />
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function EDAStep() {
  const { activeSpace, selectedTables, edaDone, setEdaDone } = useWizard();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ColumnAnnotation[]>([]);
  const [loaded, setLoaded] = useState(false);

  const runEDA = async () => {
    if (!activeSpace) return;
    setRunning(true);
    setError(null);
    try {
      await api.runEDA(activeSpace.source_id, selectedTables.length > 0 ? selectedTables : undefined);
      const anns = await api.getEDA(activeSpace.source_id);
      setAnnotations(anns);
      setEdaDone(true);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const loadExisting = async () => {
    if (!activeSpace || loaded) return;
    try {
      const anns = await api.getEDA(activeSpace.source_id);
      if (anns.length > 0) {
        setAnnotations(anns);
        setEdaDone(true);
        setLoaded(true);
      }
    } catch {
      // no prior EDA run
    }
  };

  // Load existing EDA results on mount
  useEffect(() => { loadExisting(); }, [activeSpace?.id]);

  const handleOverride = (col: string, table: string, st: string) => {
    setAnnotations((prev) =>
      prev.map((a) =>
        a.column_name === col && a.table_name === table
          ? { ...a, user_semantic_type: st }
          : a,
      ),
    );
  };

  if (!activeSpace) return <Alert severity="warning">Complete Step 1 first.</Alert>;
  if (selectedTables.length === 0) return <Alert severity="warning">Complete Step 2 first: select at least one table.</Alert>;

  // Group by table
  const byTable: Record<string, ColumnAnnotation[]> = {};
  for (const ann of annotations) {
    if (!byTable[ann.table_name]) byTable[ann.table_name] = [];
    byTable[ann.table_name].push(ann);
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Box>
          <Typography variant="h5">EDA — Column Analysis</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14, mt: 0.5 }}>
            Statistical profiling of each column. No LLM — pure data analysis.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={runEDA}
          disabled={running}
          size="small"
        >
          {running ? "Analysing…" : loaded ? "Re-run EDA" : "Run EDA"}
        </Button>
      </Stack>

      {running && <LinearProgress sx={{ mb: 2, borderRadius: 4 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loaded && !running && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Click "Run EDA" to analyse {selectedTables.length} table(s): {selectedTables.join(", ")}.
          Results are logged to MLflow for lineage.
        </Alert>
      )}

      {loaded && Object.entries(byTable).map(([table, cols]) => (
        <Accordion key={table} defaultExpanded={Object.keys(byTable).length === 1} sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" alignItems="center" gap={2}>
              <Typography variant="subtitle2" sx={{ fontFamily: "monospace" }}>{table}</Typography>
              <Chip label={`${cols.length} columns`} size="small" />
              <Chip label={`${cols[0]?.total_rows.toLocaleString()} rows`} size="small" variant="outlined" />
              {/* Semantic type summary */}
              {Object.entries(
                cols.reduce<Record<string, number>>((acc, c) => {
                  const t = c.user_semantic_type ?? c.semantic_type;
                  acc[t] = (acc[t] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([t, n]) => (
                <Chip
                  key={t}
                  label={`${n} ${t}`}
                  size="small"
                  color={TYPE_COLOR[t as SemanticType] ?? "default"}
                  variant="outlined"
                />
              ))}
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Divider sx={{ mb: 1.5 }} />
            {cols.map((ann) => (
              <ColumnCard
                key={ann.id}
                ann={ann}
                sourceId={activeSpace.source_id}
                onOverride={handleOverride}
              />
            ))}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
