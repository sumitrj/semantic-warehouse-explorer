/**
 * Step 1 — Space Selection
 *
 * Shows all existing Table Spaces. User selects one or creates a new one.
 * On selection the wizard context is populated with the space (which carries
 * source_id and tables — no separate source-connection step needed).
 */
import { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, CardActionArea, Stack,
  Chip, Divider, Button, Alert, CircularProgress, Tooltip,
  TextField, FormControl, InputLabel, Select, MenuItem,
  OutlinedInput, ListItemText, Dialog, DialogTitle,
  DialogContent, DialogActions,
} from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { api, type TableSpace, type Source, type ConfigTable } from "../../api/client";
import { useWizard } from "./ConfigWizard";

// ─── Create space dialog (inline, wizard-specific) ────────────────────────────

function CreateSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: TableSpace) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [name, setName] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [availTables, setAvailTables] = useState<ConfigTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [primaryTable, setPrimaryTable] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listSources().then(setSources).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!sourceId) return;
    setLoadingTables(true);
    api.listConfigTables(sourceId)
      .then((ts) => { setAvailTables(ts); setSelectedTables([]); setPrimaryTable(""); })
      .catch(() => {})
      .finally(() => setLoadingTables(false));
  }, [sourceId]);

  const slugify = (v: string) =>
    v.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_\-]/g, "");

  const handleCreate = async () => {
    if (!name || !displayName || !sourceId || selectedTables.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const space = await api.createSpace({
        name,
        display_name: displayName,
        source_id: sourceId,
        tables: selectedTables,
        primary_table: primaryTable || selectedTables[0],
      });
      onCreated(space);
      onClose();
      setDisplayName(""); setName(""); setSourceId("");
      setSelectedTables([]); setPrimaryTable("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" gap={1}>
          <LayersIcon color="primary" />
          <span>Create Table Space</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <Tooltip title="Human-readable label shown in the UI" placement="top-start">
            <TextField
              label="Display name"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setName(slugify(e.target.value)); }}
              size="small"
              fullWidth
              placeholder="e.g. Loyalty Programme"
            />
          </Tooltip>
          <Tooltip title="Lowercase, underscores only. Must be unique." placement="top-start">
            <TextField
              label="Slug (auto)"
              value={name}
              onChange={(e) => setName(slugify(e.target.value))}
              size="small"
              fullWidth
              InputProps={{ sx: { fontFamily: "monospace" } }}
            />
          </Tooltip>

          <Divider />

          <Tooltip title="The data source that contains your tables" placement="top-start">
            <FormControl size="small" fullWidth>
              <InputLabel>Source</InputLabel>
              <Select label="Source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Typography variant="body2">{s.name}</Typography>
                      <Chip label={s.kind} size="small" variant="outlined" />
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Tooltip>

          {sourceId && (
            <>
              {loadingTables ? (
                <Stack direction="row" alignItems="center" gap={1}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">Loading tables…</Typography>
                </Stack>
              ) : (
                <>
                  <Tooltip title="Tables from this source to include in the space" placement="top-start">
                    <FormControl size="small" fullWidth>
                      <InputLabel>Tables (multi-select)</InputLabel>
                      <Select
                        multiple
                        label="Tables (multi-select)"
                        value={selectedTables}
                        onChange={(e) => setSelectedTables(e.target.value as string[])}
                        input={<OutlinedInput label="Tables (multi-select)" />}
                        renderValue={(sel) => sel.join(", ")}
                        MenuProps={{ PaperProps: { style: { maxHeight: 240 } } }}
                      >
                        {availTables.map((t) => (
                          <MenuItem key={t.name} value={t.name}>
                            <ListItemText
                              primary={t.name}
                              secondary={`${t.row_count.toLocaleString()} rows · ${t.col_count} cols`}
                            />
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Tooltip>

                  {selectedTables.length > 0 && (
                    <Tooltip title="Main entity table for clustering and exploration" placement="top-start">
                      <FormControl size="small" fullWidth>
                        <InputLabel>Primary / entity table</InputLabel>
                        <Select
                          label="Primary / entity table"
                          value={primaryTable}
                          onChange={(e) => setPrimaryTable(e.target.value)}
                        >
                          {selectedTables.map((t) => (
                            <MenuItem key={t} value={t}>{t}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Tooltip>
                  )}
                </>
              )}
            </>
          )}

          {error && <Alert severity="error" sx={{ fontSize: 12 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={saving || !name || !displayName || !sourceId || selectedTables.length === 0}
        >
          {saving ? "Creating…" : "Create space"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Step component ───────────────────────────────────────────────────────────

export function SpaceStep() {
  const { activeSpace, setActiveSpace } = useWizard();

  const [spaces, setSpaces] = useState<TableSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.listSpaces();
      setSpaces(list);
      if (!activeSpace && list.length > 0) {
        const def = list.find((s) => s.is_default) ?? list[0];
        setActiveSpace(def);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreated = async (space: TableSpace) => {
    await load();
    setActiveSpace(space);
  };

  if (loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Table Space</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, fontSize: 14 }}>
        A Space scopes all analysis to a named set of tables from one source.
        Select an existing space or create a new one to begin configuration.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {spaces.length > 0 ? (
        <>
          <Typography
            variant="subtitle2"
            sx={{ mb: 1.5, color: "text.secondary", textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }}
          >
            Available spaces
          </Typography>
          <Stack direction="row" gap={2} flexWrap="wrap" mb={3}>
            {spaces.map((s) => {
              const selected = activeSpace?.id === s.id;
              return (
                <Card
                  key={s.id}
                  sx={{
                    minWidth: 240, maxWidth: 320,
                    border: "2px solid",
                    borderColor: selected ? "primary.main" : "transparent",
                    boxShadow: selected ? "0 0 0 4px rgba(26,35,126,0.08)" : undefined,
                    transition: "all 0.15s ease",
                  }}
                >
                  <CardActionArea onClick={() => setActiveSpace(s)} sx={{ p: 0 }}>
                    <CardContent>
                      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={0.5}>
                        <Stack direction="row" alignItems="center" gap={1}>
                          <LayersIcon fontSize="small" color={selected ? "primary" : "action"} />
                          <Typography variant="subtitle2" fontWeight={700}>{s.display_name}</Typography>
                        </Stack>
                        <Stack direction="row" alignItems="center" gap={0.5}>
                          {s.is_default && <Chip label="default" size="small" color="primary" />}
                          {selected && <CheckCircleIcon sx={{ color: "primary.main", fontSize: 18 }} />}
                        </Stack>
                      </Stack>

                      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                        {s.tables.length} tables · entity: {s.primary_table ?? "—"}
                      </Typography>

                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {s.tables.map((t) => (
                          <Chip
                            key={t}
                            label={t}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 10, fontFamily: "monospace" }}
                          />
                        ))}
                      </Stack>

                      {s.description && (
                        <Tooltip
                          title={
                            <Typography variant="caption" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 11 }}>
                              {s.description.split("\n").slice(0, 6).join("\n")}
                            </Typography>
                          }
                          placement="bottom-start"
                          arrow
                        >
                          <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: 1 }}>
                            <InfoOutlinedIcon sx={{ fontSize: 13, color: "text.disabled" }} />
                            <Typography variant="caption" color="text.disabled" noWrap>
                              {s.description.split("\n")[0].slice(0, 60)}…
                            </Typography>
                          </Stack>
                        </Tooltip>
                      )}
                    </CardContent>
                  </CardActionArea>
                </Card>
              );
            })}
          </Stack>
        </>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          No spaces found. Create one below to get started.
        </Alert>
      )}

      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={() => setCreateOpen(true)}
        size="small"
      >
        New space…
      </Button>

      {activeSpace && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mt: 3 }}>
          <strong>{activeSpace.display_name}</strong> selected —{" "}
          {activeSpace.tables.length} tables, entity: {activeSpace.primary_table ?? "—"}.
          Proceed to Table Explorer.
        </Alert>
      )}

      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Box>
  );
}
