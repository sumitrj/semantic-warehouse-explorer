/**
 * SpaceSelector — compact AppBar dropdown for switching / creating spaces.
 *
 * Shows: active space name → dropdown of all spaces + "New space" trigger.
 * Creation dialog: slug, display name, source, table multi-select.
 * Tooltips on each space show the semantic description snippet.
 */
import { useEffect, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, InputLabel,
  ListItemText, MenuItem, OutlinedInput, Select, Stack, TextField,
  Tooltip, Typography, Alert, IconButton,
} from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import AddIcon from "@mui/icons-material/Add";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { api, type Source, type ConfigTable, type TableSpace } from "../api/client";
import { useAppCtx } from "../state/appContext";

// ─── Space description tooltip ────────────────────────────────────────────────

function DescriptionTooltip({ space }: { space: TableSpace }) {
  const [generating, setGenerating] = useState(false);

  const generate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setGenerating(true);
    try {
      await api.describeSpace(space.id);
      // Description is updated server-side — user can re-open tooltip
    } finally {
      setGenerating(false);
    }
  };

  const preview = space.description
    ? space.description.split("\n").slice(0, 6).join("\n")
    : "No description yet — click to generate.";

  return (
    <Tooltip
      arrow
      placement="bottom-start"
      title={
        <Box sx={{ maxWidth: 360, p: 0.5 }}>
          <Typography variant="caption" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 11 }}>
            {preview}
          </Typography>
          {!space.description && (
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={generate}
                disabled={generating}
                sx={{ fontSize: 10, py: 0.2 }}
              >
                {generating ? "Generating…" : "Generate description"}
              </Button>
            </Box>
          )}
        </Box>
      }
    >
      <IconButton size="small" sx={{ color: "rgba(255,255,255,0.6)", p: 0.3 }}>
        <InfoOutlinedIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
  );
}

// ─── Create space dialog ──────────────────────────────────────────────────────

function CreateSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: TableSpace) => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [availTables, setAvailTables] = useState<ConfigTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [primaryTable, setPrimaryTable] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);

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
        is_default: isDefault,
      });
      onCreated(space);
      onClose();
      // Reset
      setName(""); setDisplayName(""); setSourceId("");
      setSelectedTables([]); setPrimaryTable(""); setIsDefault(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const slugify = (v: string) => v.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_\-]/g, "");

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
          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setName(slugify(e.target.value));
            }}
            size="small"
            fullWidth
            placeholder="e.g. Loyalty Programme"
            helperText="Human-readable label shown in the UI"
          />
          <TextField
            label="Slug (auto)"
            value={name}
            onChange={(e) => setName(slugify(e.target.value))}
            size="small"
            fullWidth
            placeholder="e.g. loyalty_programme"
            helperText="Lowercase, underscores only. Must be unique."
            InputProps={{ sx: { fontFamily: "monospace" } }}
          />

          <Divider />

          <Tooltip title="The data source that contains your tables" placement="top-start">
            <FormControl size="small" fullWidth>
              <InputLabel>Source</InputLabel>
              <Select
                label="Source"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
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
                  <Tooltip title="All tables from this source that you want in scope for this space" placement="top-start">
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
                    <Tooltip title="The main entity table for clustering and exploration (e.g. 'members' in a loyalty programme)" placement="top-start">
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

// ─── Main selector ────────────────────────────────────────────────────────────

export function SpaceSelector() {
  const { spaces, activeSpace, setActiveSpace, reloadSpaces, spacesLoading } = useAppCtx();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = async (space: TableSpace) => {
    await reloadSpaces();
    setActiveSpace(space);
  };

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <LayersIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }} />

        {spacesLoading ? (
          <CircularProgress size={12} sx={{ color: "rgba(255,255,255,0.7)" }} />
        ) : (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Select
              value={activeSpace?.id ?? ""}
              onChange={(e) => {
                const s = spaces.find((x) => x.id === e.target.value);
                if (s) setActiveSpace(s);
              }}
              open={menuOpen}
              onOpen={() => setMenuOpen(true)}
              onClose={() => setMenuOpen(false)}
              size="small"
              displayEmpty
              variant="standard"
              disableUnderline
              IconComponent={KeyboardArrowDownIcon}
              renderValue={(val) => (
                <Typography sx={{ color: "white", fontSize: 13, fontWeight: 600 }}>
                  {activeSpace?.display_name ?? "No space"}
                </Typography>
              )}
              sx={{
                "& .MuiSelect-select": { py: 0, pr: "24px !important", color: "white" },
                "& .MuiSvgIcon-root": { color: "rgba(255,255,255,0.6)", fontSize: 16 },
                bgcolor: "transparent",
                color: "white",
                minWidth: 130,
              }}
              MenuProps={{
                PaperProps: {
                  sx: { maxHeight: 320, mt: 0.5, minWidth: 260 },
                },
              }}
            >
              {spaces.length === 0 && (
                <MenuItem disabled>
                  <Typography variant="caption" color="text.secondary">No spaces — create one</Typography>
                </MenuItem>
              )}
              {spaces.map((s) => (
                <MenuItem key={s.id} value={s.id} sx={{ py: 1 }}>
                  <Stack sx={{ width: "100%" }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Typography variant="body2" fontWeight={600}>{s.display_name}</Typography>
                      {s.is_default && <Chip label="default" size="small" color="primary" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {s.tables.length} tables · primary: {s.primary_table ?? "—"}
                    </Typography>
                  </Stack>
                </MenuItem>
              ))}
              <Divider />
              <MenuItem
                onClick={() => { setMenuOpen(false); setCreateOpen(true); }}
                sx={{ color: "primary.main", fontWeight: 600 }}
              >
                <AddIcon fontSize="small" sx={{ mr: 1 }} />
                New space…
              </MenuItem>
            </Select>

            {activeSpace && <DescriptionTooltip space={activeSpace} />}
          </Box>
        )}
      </Box>

      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
