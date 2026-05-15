import { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, CardHeader, Stack, Button,
  Select, MenuItem, FormControl, InputLabel, Chip, IconButton,
  CircularProgress, Alert, Divider, List, ListItem, ListItemText,
  ListItemSecondaryAction, Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { api, type Dataset, type Pipeline, type PipelineStep } from "../api/client";

interface StepCatalogueEntry {
  op: string; label: string; description: string;
  params: { name: string; type: string; label: string; default?: unknown; options?: string[] }[];
}

export function PreprocessingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState<Dataset | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [catalogue, setCatalogue] = useState<StepCatalogueEntry[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [addingOp, setAddingOp] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.listDatasets(), api.stepCatalogue()])
      .then(([ds, cat]) => {
        setDatasets(ds as Dataset[]);
        setCatalogue(cat as StepCatalogueEntry[]);
        if (ds[0]) setSelectedDs(ds[0] as Dataset);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedDs) return;
    api.listPipelines(selectedDs.id)
      .then((ps) => {
        setPipelines(ps);
        if (ps[0]) { setSelectedPipeline(ps[0]); setSteps(ps[0].steps); }
        else { setSelectedPipeline(null); setSteps([]); }
      })
      .catch(() => {});
  }, [selectedDs]);

  const addStep = () => {
    if (!addingOp) return;
    const cat = catalogue.find((c) => c.op === addingOp);
    const params: Record<string, unknown> = {};
    cat?.params.forEach((p) => { if (p.default !== undefined) params[p.name] = p.default; });
    setSteps([...steps, { op: addingOp, params }]);
    setAddingOp("");
  };

  const removeStep = (i: number) => setSteps(steps.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!selectedDs) return;
    setSaving(true);
    setSaved(false);
    try {
      if (selectedPipeline) {
        const updated = await api.updatePipeline(selectedPipeline.id, steps);
        setSelectedPipeline(updated);
      } else {
        const created = await api.createPipeline({ dataset_id: selectedDs.id, name: "default", steps });
        setSelectedPipeline(created);
        setPipelines([created]);
      }
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
      <Typography variant="h6" gutterBottom>Preprocessing Pipeline</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Steps run in sequence before feature extraction. Changes take effect on the next clustering run.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>Pipeline saved.</Alert>}

      <Stack direction="row" gap={3} alignItems="flex-start">
        {/* Dataset picker */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Dataset</InputLabel>
          <Select
            label="Dataset"
            value={selectedDs?.id ?? ""}
            onChange={(e) => setSelectedDs(datasets.find((d) => d.id === e.target.value) ?? null)}
          >
            {datasets.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Stack direction="row" gap={3} alignItems="flex-start">
        {/* Pipeline steps */}
        <Card sx={{ flex: 1 }}>
          <CardHeader
            title={<Typography variant="subtitle1" fontWeight={600}>Steps</Typography>}
            subheader={`${steps.length} step${steps.length !== 1 ? "s" : ""} configured`}
            action={
              <Button
                size="small"
                variant="contained"
                onClick={save}
                disabled={saving}
                startIcon={saving ? <CircularProgress size={14} /> : undefined}
              >
                {saving ? "Saving…" : "Save pipeline"}
              </Button>
            }
          />
          <CardContent>
            {steps.length === 0 && (
              <Typography color="text.secondary" variant="body2" sx={{ fontStyle: "italic" }}>
                No steps yet — data will be extracted as-is.
              </Typography>
            )}
            <List dense disablePadding>
              {steps.map((step, i) => {
                const cat = catalogue.find((c) => c.op === step.op);
                return (
                  <ListItem
                    key={i}
                    sx={{ bgcolor: "grey.50", borderRadius: 1, mb: 1, border: "1px solid", borderColor: "divider" }}
                  >
                    <DragIndicatorIcon sx={{ mr: 1, color: "text.disabled", fontSize: 18 }} />
                    <ListItemText
                      primary={
                        <Stack direction="row" gap={1} alignItems="center">
                          <Chip label={step.op} size="small" color="primary" />
                          <Typography variant="body2">{cat?.label}</Typography>
                        </Stack>
                      }
                      secondary={
                        Object.entries(step.params).length > 0
                          ? Object.entries(step.params)
                              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
                              .join(" · ")
                          : "default params"
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton size="small" onClick={() => removeStep(i)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                );
              })}
            </List>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" gap={1} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Add step</InputLabel>
                <Select
                  label="Add step"
                  value={addingOp}
                  onChange={(e) => setAddingOp(e.target.value)}
                >
                  {catalogue.map((c) => (
                    <MenuItem key={c.op} value={c.op}>
                      <Tooltip title={c.description} placement="right">
                        <span>{c.label}</span>
                      </Tooltip>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={addStep}
                disabled={!addingOp}
              >
                Add
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* Catalogue */}
        <Card sx={{ minWidth: 260 }}>
          <CardHeader title={<Typography variant="subtitle1" fontWeight={600}>Available operations</Typography>} />
          <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
            <List dense>
              {catalogue.map((c) => (
                <ListItem key={c.op} divider>
                  <ListItemText
                    primary={<Stack direction="row" gap={1} alignItems="center">
                      <Chip label={c.op} size="small" variant="outlined" />
                      <Typography variant="body2">{c.label}</Typography>
                    </Stack>}
                    secondary={c.description}
                  />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
