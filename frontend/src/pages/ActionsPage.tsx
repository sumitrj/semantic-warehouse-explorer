import { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, CardHeader, Stack, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Switch,
  FormControlLabel, IconButton, Chip, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { api, type Action } from "../api/client";

const EMPTY_ACTION: Omit<Action, "id" | "created_at"> = {
  name: "", description: "", grain: "cluster", trigger_rule: {}, enabled: true,
};

export function ActionsPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Action | null>(null);
  const [form, setForm] = useState({ ...EMPTY_ACTION });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.listActions()
      .then(setActions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => { setForm({ ...EMPTY_ACTION }); setEditing(null); setDialogOpen(true); };
  const openEdit = (a: Action) => {
    setForm({ name: a.name, description: a.description ?? "", grain: a.grain, trigger_rule: a.trigger_rule, enabled: a.enabled });
    setEditing(a);
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.updateAction(editing.id, form as any);
      } else {
        await api.createAction(form as any);
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    try {
      await api.deleteAction(id);
      setActions((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
      <Stack direction="row" alignItems="center" mb={2} gap={2}>
        <AutoFixHighIcon color="primary" />
        <Typography variant="h6">Action Catalog</Typography>
        <Box flex={1} />
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
          New action
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" mb={3}>
        Actions represent interventions that can be applied to clusters or individual entities.
        The recommendation LLM uses this catalog to suggest targeted actions based on cluster profiles.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}><CircularProgress /></Box>
      ) : actions.length === 0 ? (
        <Card sx={{ textAlign: "center", p: 4 }}>
          <Typography color="text.secondary">No actions yet. Create one to enable LLM recommendations.</Typography>
          <Button sx={{ mt: 2 }} variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>
            Create first action
          </Button>
        </Card>
      ) : (
        <Stack gap={2}>
          {actions.map((a) => (
            <Card key={a.id} sx={{ opacity: a.enabled ? 1 : 0.55 }}>
              <CardContent>
                <Stack direction="row" alignItems="flex-start" gap={1}>
                  <Box flex={1}>
                    <Stack direction="row" gap={1} alignItems="center" mb={0.5}>
                      <Typography variant="subtitle2" fontWeight={600}>{a.name}</Typography>
                      <Chip
                        label={a.grain}
                        size="small"
                        color={a.grain === "cluster" ? "primary" : "secondary"}
                        variant="outlined"
                      />
                      {!a.enabled && <Chip label="disabled" size="small" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {a.description || <em>No description</em>}
                    </Typography>
                    {Object.keys(a.trigger_rule).length > 0 && (
                      <Typography variant="caption" color="text.disabled" mt={0.5} display="block">
                        Rule: {JSON.stringify(a.trigger_rule)}
                      </Typography>
                    )}
                  </Box>
                  <IconButton size="small" onClick={() => openEdit(a)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => del(a.id)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit action" : "New action"}</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            <TextField
              label="Name" size="small" fullWidth required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="Description" size="small" fullWidth multiline rows={2}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Grain</InputLabel>
              <Select
                label="Grain"
                value={form.grain}
                onChange={(e) => setForm({ ...form, grain: e.target.value as "cluster" | "entity" })}
              >
                <MenuItem value="cluster">Cluster — applied to an entire cluster</MenuItem>
                <MenuItem value="entity">Entity — applied to individual records</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
              }
              label="Enabled (included in LLM recommendation prompts)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={!form.name.trim() || saving}
            startIcon={saving ? <CircularProgress size={14} /> : undefined}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
