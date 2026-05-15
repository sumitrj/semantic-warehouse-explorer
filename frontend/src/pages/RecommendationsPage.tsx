import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Card, CardContent, Button, Chip,
  Select, MenuItem, FormControl, InputLabel, TextField, Alert,
  CircularProgress, Divider, Tabs, Tab,
} from "@mui/material";
import RecommendIcon from "@mui/icons-material/Recommend";
import PersonIcon from "@mui/icons-material/Person";
import GroupsIcon from "@mui/icons-material/Groups";
import { StreamingText } from "../components/StreamingText";
import { api, type Dataset, type ClusteringRun } from "../api/client";

// Pastel cluster colours — must match ExplorerPage
const CLUSTER_COLORS = [
  "#4C72B0","#DD8452","#55A868","#C44E52","#8172B3",
  "#937860","#DA8BC3","#8C8C8C","#CCB974","#64B5CD",
];
function clusterColor(id: number) {
  return CLUSTER_COLORS[((id % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length];
}

export function RecommendationsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState<Dataset | null>(null);
  const [runs, setRuns] = useState<ClusteringRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ClusteringRun | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [entityId, setEntityId] = useState("");
  const [grain, setGrain] = useState<"cluster" | "entity">("cluster");

  // streaming
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(false);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listDatasets()
      .then((ds) => {
        setDatasets(ds);
        if (ds[0]) setSelectedDs(ds[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedDs) return;
    api.listRunsForDataset(selectedDs.id).then((rs) => {
      // most recent first
      const sorted = [...rs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRuns(sorted);
      if (sorted[0]) setSelectedRun(sorted[0]);
    });
  }, [selectedDs]);

  const clusters = selectedRun
    ? Object.keys(selectedRun.result.cluster_sizes).map(Number).sort((a, b) => a - b)
    : [];

  const handleStream = async () => {
    if (!selectedRun || selectedCluster === null) return;
    setStreaming(true);
    setStreamText("");
    setError(null);
    try {
      if (grain === "cluster") {
        await api.streamClusterRecommend(
          selectedRun.id, selectedCluster,
          (t) => setStreamText((p) => p + t),
          (e) => setError(e),
          refresh,
        );
      } else {
        if (!entityId.trim()) { setError("Enter an entity ID first."); setStreaming(false); return; }
        await api.streamEntityRecommend(
          selectedRun.id, selectedCluster, entityId.trim(),
          (t) => setStreamText((p) => p + t),
          (e) => setError(e),
          refresh,
        );
      }
    } finally {
      setStreaming(false);
      setRefresh(false);
    }
  };

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
      <Stack direction="row" alignItems="center" gap={1} mb={1}>
        <RecommendIcon color="primary" />
        <Typography variant="h6">Recommendations</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={3}>
        The LLM analyses cluster profiles and your action catalog to generate targeted recommendations —
        at cluster grain (what to do for this group) and entity grain (what to do for this specific record).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Config row */}
      <Stack direction="row" gap={2} flexWrap="wrap" mb={3}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Dataset</InputLabel>
          <Select
            label="Dataset"
            value={selectedDs?.id ?? ""}
            onChange={(e) => setSelectedDs(datasets.find((d) => d.id === e.target.value) ?? null)}
          >
            {datasets.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>Clustering run</InputLabel>
          <Select
            label="Clustering run"
            value={selectedRun?.id ?? ""}
            onChange={(e) => setSelectedRun(runs.find((r) => r.id === e.target.value) ?? null)}
          >
            {runs.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.algorithm} · {r.n_clusters} clusters · {new Date(r.created_at).toLocaleTimeString()}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {selectedRun && (
        <Stack direction="row" gap={3} alignItems="flex-start">
          {/* Cluster picker */}
          <Card sx={{ minWidth: 220 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Select cluster</Typography>
              <Stack gap={1} mt={1}>
                {clusters.map((cid) => (
                  <Chip
                    key={cid}
                    label={`Cluster ${cid} · ${selectedRun.result.cluster_sizes[cid]} entities`}
                    onClick={() => setSelectedCluster(cid === selectedCluster ? null : cid)}
                    sx={{
                      bgcolor: selectedCluster === cid ? clusterColor(cid) : undefined,
                      color: selectedCluster === cid ? "white" : undefined,
                      fontWeight: selectedCluster === cid ? 700 : 400,
                      justifyContent: "flex-start",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </Stack>
            </CardContent>
          </Card>

          {/* Recommendation panel */}
          <Card sx={{ flex: 1 }}>
            <CardContent>
              {/* Grain tabs */}
              <Tabs
                value={grain}
                onChange={(_, v) => { setGrain(v); setStreamText(""); }}
                sx={{ mb: 2 }}
              >
                <Tab
                  value="cluster"
                  label="Cluster grain"
                  icon={<GroupsIcon fontSize="small" />}
                  iconPosition="start"
                  sx={{ textTransform: "none", minHeight: 40 }}
                />
                <Tab
                  value="entity"
                  label="Entity grain"
                  icon={<PersonIcon fontSize="small" />}
                  iconPosition="start"
                  sx={{ textTransform: "none", minHeight: 40 }}
                />
              </Tabs>

              {grain === "entity" && (
                <TextField
                  label="Entity ID"
                  size="small"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  sx={{ mb: 2 }}
                  placeholder="e.g. E00042"
                  fullWidth
                />
              )}

              <Stack direction="row" gap={1} mb={2}>
                <Button
                  variant="contained"
                  startIcon={streaming ? <CircularProgress size={14} color="inherit" /> : <RecommendIcon />}
                  onClick={handleStream}
                  disabled={streaming || selectedCluster === null}
                >
                  {streaming ? "Generating…" : "Generate recommendation"}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => { setRefresh(true); handleStream(); }}
                  disabled={streaming || selectedCluster === null}
                >
                  Refresh
                </Button>
              </Stack>

              {selectedCluster !== null ? (
                <>
                  <Stack direction="row" gap={1} alignItems="center" mb={1}>
                    <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: clusterColor(selectedCluster) }} />
                    <Typography variant="caption" color="text.secondary">
                      {grain === "cluster"
                        ? `Cluster ${selectedCluster} · ${selectedRun.result.cluster_sizes[selectedCluster]} entities`
                        : `Entity ${entityId || "—"} in Cluster ${selectedCluster}`}
                    </Typography>
                  </Stack>
                  <StreamingText
                    text={streamText}
                    streaming={streaming}
                    placeholder="Select a cluster and hit 'Generate recommendation' to stream the LLM output."
                    sx={{ mt: 0 }}
                  />
                </>
              ) : (
                <Typography color="text.secondary" variant="body2" sx={{ fontStyle: "italic" }}>
                  Select a cluster on the left to get started.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
    </Box>
  );
}
