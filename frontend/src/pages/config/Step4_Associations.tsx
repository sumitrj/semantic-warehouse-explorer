/**
 * Step 4 — Associations Builder
 *
 * Runs join discovery across selected tables (no LLM — heuristic SQL scoring).
 * Shows each candidate join with confidence score and join-type badge.
 * User confirms or rejects each suggestion. Manual joins can be added.
 */
import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Chip, Alert, Button, Card, CardContent,
  LinearProgress, IconButton, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Divider,
  Badge,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import UndoIcon from "@mui/icons-material/Undo";
import AddIcon from "@mui/icons-material/Add";
import LinkIcon from "@mui/icons-material/Link";
import { api, type JoinSuggestion } from "../../api/client";
import { useWizard } from "./ConfigWizard";

const JOIN_TYPE_COLOR: Record<string, "success" | "primary" | "warning" | "default"> = {
  fk: "success",
  natural: "primary",
  overlap: "warning",
  manual: "default",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? "success" : value >= 0.5 ? "warning" : "error";
  return (
    <Tooltip title={`Confidence: ${pct}%`}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Box sx={{ width: 60, bgcolor: "grey.100", borderRadius: 4, overflow: "hidden", height: 6 }}>
          <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: `${color}.main` }} />
        </Box>
        <Typography variant="caption" color="text.secondary">{pct}%</Typography>
      </Box>
    </Tooltip>
  );
}

function JoinCard({
  join,
  onStatus,
}: {
  join: JoinSuggestion;
  onStatus: (id: string, status: "confirmed" | "rejected" | "pending") => void;
}) {
  const bgColor =
    join.status === "confirmed"
      ? "rgba(46,125,50,0.05)"
      : join.status === "rejected"
      ? "rgba(198,40,40,0.04)"
      : "background.paper";

  const borderColor =
    join.status === "confirmed"
      ? "success.main"
      : join.status === "rejected"
      ? "error.light"
      : "divider";

  return (
    <Card sx={{ border: "1.5px solid", borderColor, bgcolor: bgColor, transition: "all 0.15s" }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          {/* Left side */}
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
            {join.left_table}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: "monospace", color: "primary.main" }}>
            .{join.left_column}
          </Typography>

          <LinkIcon sx={{ fontSize: 14, color: "text.secondary", mx: 0.5 }} />

          {/* Right side */}
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
            {join.right_table}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: "monospace", color: "primary.main" }}>
            .{join.right_column}
          </Typography>

          <Box sx={{ flex: 1 }} />

          {/* Metadata */}
          <Chip
            label={join.join_type.toUpperCase()}
            size="small"
            color={JOIN_TYPE_COLOR[join.join_type] ?? "default"}
            variant="outlined"
          />
          <ConfidenceBar value={join.confidence} />

          {/* Actions */}
          {join.status === "pending" && (
            <>
              <Tooltip title="Confirm join">
                <IconButton size="small" color="success" onClick={() => onStatus(join.id, "confirmed")}>
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Reject join">
                <IconButton size="small" color="error" onClick={() => onStatus(join.id, "rejected")}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {join.status !== "pending" && (
            <Tooltip title="Reset to pending">
              <IconButton size="small" onClick={() => onStatus(join.id, "pending")}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Chip
            label={join.status}
            size="small"
            color={join.status === "confirmed" ? "success" : join.status === "rejected" ? "error" : "default"}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function AssociationsStep() {
  const { activeSpace, selectedTables, joinsDone, setJoinsDone } = useWizard();
  const [joins, setJoins] = useState<JoinSuggestion[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Manual join dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [mLeft, setMLeft] = useState({ table: "", col: "" });
  const [mRight, setMRight] = useState({ table: "", col: "" });
  const [mSaving, setMSaving] = useState(false);

  const loadJoins = async () => {
    if (!activeSpace) return;
    try {
      const j = await api.getJoins(activeSpace.source_id);
      setJoins(j);
      if (j.some((x) => x.status === "confirmed")) setJoinsDone(true);
      setLoaded(true);
    } catch {
      // no prior run
    }
  };

  useEffect(() => { loadJoins(); }, [activeSpace?.id]);

  const runDiscovery = async () => {
    if (!activeSpace) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.discoverJoins(activeSpace.source_id, selectedTables);
      const j = await api.getJoins(activeSpace.source_id);
      setJoins(j);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleStatus = async (id: string, status: "confirmed" | "rejected" | "pending") => {
    if (!activeSpace) return;
    await api.setJoinStatus(activeSpace.source_id, id, status);
    setJoins((prev) => prev.map((j) => (j.id === id ? { ...j, status } : j)));
    const updated = joins.map((j) => (j.id === id ? { ...j, status } : j));
    setJoinsDone(updated.some((j) => j.status === "confirmed"));
  };

  const addManual = async () => {
    if (!activeSpace || !mLeft.table || !mLeft.col || !mRight.table || !mRight.col) return;
    setMSaving(true);
    try {
      await api.addManualJoin(activeSpace.source_id, mLeft.table, mLeft.col, mRight.table, mRight.col);
      const j = await api.getJoins(activeSpace.source_id);
      setJoins(j);
      setJoinsDone(true);
      setManualOpen(false);
      setMLeft({ table: "", col: "" });
      setMRight({ table: "", col: "" });
    } finally {
      setMSaving(false);
    }
  };

  if (!activeSpace) return <Alert severity="warning">Complete Step 1 first.</Alert>;
  if (selectedTables.length < 2) return (
    <Alert severity="info">
      Associations require at least 2 tables. Select more tables in Step 2.
      <br />
      You can skip this step if you only have one table.
    </Alert>
  );

  const confirmed = joins.filter((j) => j.status === "confirmed");
  const pending = joins.filter((j) => j.status === "pending");
  const rejected = joins.filter((j) => j.status === "rejected");

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Box>
          <Typography variant="h5">Associations Builder</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14, mt: 0.5 }}>
            Discover joins between tables via name and content heuristics — no LLM.
            Confirm the joins you want to use.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            size="small"
            onClick={() => setManualOpen(true)}
          >
            Manual join
          </Button>
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={runDiscovery}
            disabled={running}
            size="small"
          >
            {running ? "Discovering…" : loaded ? "Re-discover" : "Discover joins"}
          </Button>
        </Stack>
      </Stack>

      {running && <LinearProgress sx={{ mb: 2, borderRadius: 4 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loaded && !running && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Click "Discover joins" to analyse column compatibility across {selectedTables.length} tables.
          Results are logged to MLflow.
        </Alert>
      )}

      {loaded && (
        <>
          <Stack direction="row" gap={1} sx={{ mb: 2 }}>
            <Badge badgeContent={confirmed.length} color="success">
              <Chip label="Confirmed" size="small" color="success" />
            </Badge>
            <Badge badgeContent={pending.length} color="default">
              <Chip label="Pending" size="small" />
            </Badge>
            <Badge badgeContent={rejected.length} color="error">
              <Chip label="Rejected" size="small" color="error" variant="outlined" />
            </Badge>
          </Stack>

          {joins.length === 0 && (
            <Alert severity="info">
              No join candidates found above the confidence threshold. Use "Manual join" to add one.
            </Alert>
          )}

          {/* Confirmed */}
          {confirmed.length > 0 && (
            <>
              <Typography variant="caption" color="success.main" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
                Confirmed
              </Typography>
              <Stack gap={1} sx={{ mt: 0.5, mb: 2 }}>
                {confirmed.map((j) => <JoinCard key={j.id} join={j} onStatus={handleStatus} />)}
              </Stack>
            </>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
                Awaiting review
              </Typography>
              <Stack gap={1} sx={{ mt: 0.5, mb: 2 }}>
                {pending.map((j) => <JoinCard key={j.id} join={j} onStatus={handleStatus} />)}
              </Stack>
            </>
          )}

          {/* Rejected */}
          {rejected.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="caption" color="text.disabled" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
                Rejected
              </Typography>
              <Stack gap={1} sx={{ mt: 0.5 }}>
                {rejected.map((j) => <JoinCard key={j.id} join={j} onStatus={handleStatus} />)}
              </Stack>
            </>
          )}
        </>
      )}

      {/* Manual join dialog */}
      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Manual Join</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">Left side</Typography>
            <Stack direction="row" gap={1}>
              <TextField
                select label="Table" value={mLeft.table}
                onChange={(e) => setMLeft((p) => ({ ...p, table: e.target.value }))}
                size="small" fullWidth
              >
                {selectedTables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField
                label="Column" value={mLeft.col}
                onChange={(e) => setMLeft((p) => ({ ...p, col: e.target.value }))}
                size="small" fullWidth
              />
            </Stack>
            <Typography variant="subtitle2">Right side</Typography>
            <Stack direction="row" gap={1}>
              <TextField
                select label="Table" value={mRight.table}
                onChange={(e) => setMRight((p) => ({ ...p, table: e.target.value }))}
                size="small" fullWidth
              >
                {selectedTables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField
                label="Column" value={mRight.col}
                onChange={(e) => setMRight((p) => ({ ...p, col: e.target.value }))}
                size="small" fullWidth
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addManual} disabled={mSaving}>
            {mSaving ? "Adding…" : "Add join"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
