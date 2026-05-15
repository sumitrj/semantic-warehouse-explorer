import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Chip, Stack, Divider,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress,
  Alert,
} from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import TableChartIcon from "@mui/icons-material/TableChart";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import { api, type Source, type Dataset, type ColumnInfo, type FeatureGroup } from "../api/client";

const KIND_COLOR: Record<string, "default" | "primary" | "secondary" | "success"> = {
  duckdb_native: "primary",
  postgres: "secondary",
  parquet: "success",
  unity_catalog: "default",
};

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState<Dataset | null>(null);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [groups, setGroups] = useState<FeatureGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([api.listSources(), api.listDatasets()]);
        setSources(s);
        setDatasets(d);
        if (d[0]) setSelectedDs(d[0]);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedDs) return;
    Promise.all([
      api.datasetSchema(selectedDs.id),
      api.listFeatureGroups(selectedDs.id),
    ]).then(([sc, fg]) => { setSchema(sc); setGroups(fg); }).catch(() => {});
  }, [selectedDs]);

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Typography variant="h6" gutterBottom>Data Sources</Typography>
      <Stack direction="row" gap={2} flexWrap="wrap" mb={3}>
        {sources.map((s) => (
          <Card key={s.id} sx={{ minWidth: 260 }}>
            <CardContent>
              <Stack direction="row" alignItems="center" gap={1} mb={1}>
                <StorageIcon color="primary" fontSize="small" />
                <Typography variant="subtitle2" fontWeight={600}>{s.name}</Typography>
              </Stack>
              <Chip
                label={s.kind}
                size="small"
                color={KIND_COLOR[s.kind] ?? "default"}
                sx={{ mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary" display="block">
                {Object.entries(s.config).map(([k, v]) => `${k}: ${v}`).join(", ")}
              </Typography>
            </CardContent>
          </Card>
        ))}
        {sources.length === 0 && (
          <Typography color="text.secondary">No sources registered.</Typography>
        )}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      <Typography variant="h6" gutterBottom>Datasets</Typography>
      <Stack direction="row" gap={2} flexWrap="wrap" mb={3}>
        {datasets.map((d) => (
          <Card
            key={d.id}
            onClick={() => setSelectedDs(d)}
            sx={{
              minWidth: 240, cursor: "pointer",
              border: "1px solid",
              borderColor: selectedDs?.id === d.id ? "primary.main" : "divider",
              bgcolor: selectedDs?.id === d.id ? "primary.50" : "background.paper",
            }}
          >
            <CardContent>
              <Stack direction="row" alignItems="center" gap={1} mb={0.5}>
                <TableChartIcon color="action" fontSize="small" />
                <Typography variant="subtitle2" fontWeight={600}>{d.name}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {d.row_count?.toLocaleString() ?? "?"} rows · {d.duckdb_table}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {selectedDs && (
        <>
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h6" gutterBottom>
            Schema — {selectedDs.name}
          </Typography>

          <Stack direction="row" gap={3} alignItems="flex-start">
            {/* Schema table */}
            <Card sx={{ flex: 1 }}>
              <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "grey.50" }}>
                      <TableCell><strong>Column</strong></TableCell>
                      <TableCell><strong>Type</strong></TableCell>
                      <TableCell><strong>Feature group</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {schema.map((col) => {
                      const grp = groups.find((g) => g.columns.includes(col.name));
                      return (
                        <TableRow key={col.name} hover>
                          <TableCell sx={{ fontFamily: "monospace" }}>{col.name}</TableCell>
                          <TableCell>
                            <Chip label={col.dtype} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell>
                            {grp ? (
                              <Chip label={grp.name} size="small" color="primary" variant="outlined" />
                            ) : (
                              <Typography variant="caption" color="text.disabled">—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Feature groups */}
            <Box sx={{ minWidth: 220 }}>
              <Stack direction="row" alignItems="center" gap={1} mb={1}>
                <ViewColumnIcon fontSize="small" />
                <Typography variant="subtitle2">Feature groups</Typography>
              </Stack>
              <Stack gap={1}>
                {groups.map((g) => (
                  <Card key={g.id}>
                    <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={600}>{g.name}</Typography>
                        <Chip label={`w=${g.default_weight}`} size="small" />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {g.columns.join(", ")}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          </Stack>
        </>
      )}
    </Box>
  );
}
