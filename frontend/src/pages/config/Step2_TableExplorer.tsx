/**
 * Step 2 — Table Explorer
 *
 * Lists all DuckDB tables available in the selected source. User checks which
 * ones to work with. Click on a table name to preview first 5 rows.
 */
import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Chip, Alert, CircularProgress,
  Checkbox, FormControlLabel, Card, CardContent, Button,
  Table, TableHead, TableRow, TableCell, TableBody, Collapse,
  IconButton, Tooltip, LinearProgress,
} from "@mui/material";
import TableChartIcon from "@mui/icons-material/TableChart";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import { api, type ConfigTable } from "../../api/client";
import { useWizard } from "./ConfigWizard";

export function TableExplorerStep() {
  const { activeSpace, setActiveSpace, selectedTables, setSelectedTables } = useWizard();

  const [tables, setTables] = useState<ConfigTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, Record<string, unknown>[]>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const load = async () => {
    if (!activeSpace) return;
    setLoading(true);
    setError(null);
    try {
      const ts = await api.listConfigTables(activeSpace.source_id);
      setTables(ts);
      // Restore the selected tables from the active Table Space. This keeps
      // analysis scoped to the space instead of the whole source.
      if (activeSpace.tables.length > 0) {
        setSelectedTables(activeSpace.tables.filter((t) => ts.some((x) => x.name === t)));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeSpace?.id]);

  const toggle = (name: string) => {
    setSelectedTables(
      selectedTables.includes(name)
        ? selectedTables.filter((t) => t !== name)
        : [...selectedTables, name],
    );
    setSaveOk(false);
  };

  const toggleAll = () => {
    if (selectedTables.length === tables.length) {
      setSelectedTables([]);
    } else {
      setSelectedTables(tables.map((t) => t.name));
    }
    setSaveOk(false);
  };

  const handlePreview = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (preview[name]) return; // cached
    setPreviewLoading(name);
    try {
      const rows = await api.previewTable(name, 5);
      setPreview((prev) => ({ ...prev, [name]: rows }));
    } catch {
      setPreview((prev) => ({ ...prev, [name]: [] }));
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleSave = async () => {
    if (!activeSpace) return;
    setSaving(true);
    try {
      await api.selectTables(activeSpace.source_id, selectedTables);
      const updated = await api.updateSpace(activeSpace.id, {
        tables: selectedTables,
        primary_table: activeSpace.primary_table && selectedTables.includes(activeSpace.primary_table)
          ? activeSpace.primary_table
          : selectedTables[0],
      });
      setActiveSpace(updated);
      setSaveOk(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!activeSpace) return <Alert severity="warning">Complete Step 1 — select a Space first.</Alert>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Box>
          <Typography variant="h5">Table Explorer</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14, mt: 0.5 }}>
            Select which tables you want Semantic Explorer to work with.
          </Typography>
        </Box>
        <Tooltip title="Refresh tables">
          <IconButton onClick={load} size="small"><RefreshIcon /></IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}><CircularProgress /></Box>
      ) : (
        <>
          {/* Select all */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={tables.length > 0 && selectedTables.length === tables.length}
                  indeterminate={selectedTables.length > 0 && selectedTables.length < tables.length}
                  onChange={toggleAll}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" fontWeight={600}>
                  {selectedTables.length} / {tables.length} selected
                </Typography>
              }
            />
            <Button
              variant="contained"
              size="small"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={saving || selectedTables.length === 0}
            >
              {saving ? "Saving…" : "Save selection"}
            </Button>
          </Stack>

          {saveOk && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Selection saved — proceed to EDA.
            </Alert>
          )}

          <Stack gap={1.5}>
            {tables.map((t) => {
              const isSelected = selectedTables.includes(t.name);
              const isExpanded = expanded === t.name;
              const previewRows = preview[t.name];
              const previewCols = previewRows?.[0] ? Object.keys(previewRows[0]) : [];

              return (
                <Card
                  key={t.name}
                  sx={{
                    border: "2px solid",
                    borderColor: isSelected ? "primary.main" : "transparent",
                    transition: "border-color 0.15s",
                  }}
                >
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggle(t.name)}
                        size="small"
                      />
                      <TableChartIcon fontSize="small" color={isSelected ? "primary" : "action"} />
                      <Typography
                        variant="subtitle2"
                        sx={{ fontFamily: "monospace", flex: 1, fontWeight: isSelected ? 700 : 500 }}
                      >
                        {t.name}
                      </Typography>
                      <Chip label={`${t.row_count.toLocaleString()} rows`} size="small" />
                      <Chip label={`${t.col_count} cols`} size="small" variant="outlined" />
                      <Tooltip title="Preview">
                        <IconButton size="small" onClick={() => handlePreview(t.name)}>
                          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Stack>

                    <Collapse in={isExpanded}>
                      <Box sx={{ mt: 1.5, overflowX: "auto" }}>
                        {previewLoading === t.name ? (
                          <LinearProgress sx={{ borderRadius: 4 }} />
                        ) : previewRows && previewRows.length > 0 ? (
                          <Table size="small" sx={{ "& td, & th": { fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap" } }}>
                            <TableHead>
                              <TableRow sx={{ bgcolor: "grey.50" }}>
                                {previewCols.map((c) => (
                                  <TableCell key={c} sx={{ fontWeight: 700 }}>{c}</TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {previewRows.map((row, ri) => (
                                <TableRow key={ri} hover>
                                  {previewCols.map((c) => (
                                    <TableCell key={c}>{String(row[c] ?? "")}</TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <Typography variant="caption" color="text.secondary">No preview available.</Typography>
                        )}
                      </Box>
                    </Collapse>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>

          {tables.length === 0 && (
            <Alert severity="info">
              No tables found in DuckDB. Load some data first.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
