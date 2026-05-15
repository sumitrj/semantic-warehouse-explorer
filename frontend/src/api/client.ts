// Typed API client — all backend calls go through here.

export type UUID = string;

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface Source {
  id: UUID; name: string; kind: string; config: Record<string, unknown>;
}

export interface Dataset {
  id: UUID; source_id: UUID; name: string; duckdb_table: string;
  row_count: number | null; description: string | null;
}

export interface ColumnInfo { name: string; dtype: string; }

export interface FeatureGroup {
  id: UUID; dataset_id: UUID; name: string;
  columns: string[]; default_weight: number; description: string | null;
}

export interface Pipeline {
  id: UUID; dataset_id: UUID; name: string;
  steps: PipelineStep[]; created_at: string;
}

export interface PipelineStep {
  op: string; params: Record<string, unknown>;
}

export interface ClusteringRun {
  id: UUID; dataset_id: UUID; config_hash: string;
  algorithm: string; algorithm_params: Record<string, unknown>;
  feature_weights: Record<string, number>;
  n_clusters: number | null; silhouette: number | null;
  mlflow_run_id: string | null;
  result: {
    labels: number[]; coords: number[][];
    n_rows: number; n_features: number;
    cluster_sizes: Record<string, number>;
    feature_columns: string[];
    pca_variance?: number[];
    extra?: Record<string, unknown>;
  };
  created_at: string;
}

export interface Interpretation {
  id: UUID; clustering_run_id: UUID; cluster_id: number;
  headline: string; characteristics: string[];
  confidence: "high" | "medium" | "low";
  model_used: string; prompt_version: string;
}

export interface Action {
  id: UUID; name: string; description: string | null;
  grain: "cluster" | "entity";
  trigger_rule: Record<string, unknown>;
  enabled: boolean; created_at: string;
}

export interface Recommendation {
  id: UUID; clustering_run_id: UUID; cluster_id: number;
  entity_id: string | null; grain: string;
  text: string; model_used: string; created_at: string;
}

export interface AlgorithmMeta {
  name: string; display_name: string; description: string;
  params: Record<string, {
    type: string; default: unknown;
    min?: number; max?: number; step?: number;
    options?: string[]; label: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status}: ${text}`);
  }
  return r.json();
}

/** Read SSE stream, calling onToken for each token. Returns accumulated text. */
export async function readSSE(
  url: string,
  opts: RequestInit,
  onToken: (token: string) => void,
  onError?: (msg: string) => void,
): Promise<string> {
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return full;
      try {
        const data = JSON.parse(raw);
        if (data.error) {
          onError?.(data.error);
          return full;
        }
        if (data.token) {
          full += data.token;
          onToken(data.token);
        }
      } catch {
        // non-JSON line, skip
      }
    }
  }
  return full;
}

// ─── API object ───────────────────────────────────────────────────────────────

export const api = {
  health: () => fetch("/health").then((r) => j<{ status: string; model: string }>(r)),

  // Sources & Datasets
  listSources: () => fetch("/api/sources").then((r) => j<Source[]>(r)),
  createSource: (body: Omit<Source, "id">) =>
    fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => j<Source>(r)),

  listDatasets: () => fetch("/api/datasets").then((r) => j<Dataset[]>(r)),
  datasetSchema: (id: UUID) => fetch(`/api/datasets/${id}/schema`).then((r) => j<ColumnInfo[]>(r)),

  // Feature groups
  listFeatureGroups: (datasetId: UUID) =>
    fetch(`/api/datasets/${datasetId}/feature-groups`).then((r) => j<FeatureGroup[]>(r)),
  createFeatureGroup: (body: { dataset_id: UUID; name: string; columns: string[]; default_weight?: number; description?: string }) =>
    fetch("/api/feature-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => j<FeatureGroup>(r)),

  // Algorithms
  listAlgorithms: () => fetch("/api/algorithms").then((r) => j<AlgorithmMeta[]>(r)),

  // Clustering
  runClustering: (body: { dataset_id: UUID; algorithm?: string; algorithm_params?: Record<string, unknown>; feature_weights?: Record<string, number> }) =>
    fetch("/api/clusterings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "kmeans", ...body }),
    }).then((r) => j<ClusteringRun>(r)),

  clusterProfile: (runId: UUID, clusterId: number) =>
    fetch(`/api/clusterings/${runId}/clusters/${clusterId}/profile`).then((r) => j<Record<string, unknown>>(r)),

  listRunsForDataset: (datasetId: UUID) =>
    fetch(`/api/datasets/${datasetId}/clusterings`).then((r) => j<ClusteringRun[]>(r)),

  // Interpretations — structured (cached)
  interpret: (runId: UUID, clusterId: number, refresh = false) =>
    fetch(`/api/clusterings/${runId}/clusters/${clusterId}/interpret?refresh=${refresh}`, { method: "POST" })
      .then((r) => j<Interpretation>(r)),

  listInterpretations: (runId: UUID) =>
    fetch(`/api/clusterings/${runId}/interpretations`).then((r) => j<Interpretation[]>(r)),

  // Interpretations — streaming narrative
  streamInterpret: (
    runId: UUID,
    clusterId: number,
    onToken: (t: string) => void,
    onError?: (e: string) => void,
  ) =>
    readSSE(
      `/api/clusterings/${runId}/clusters/${clusterId}/interpret/stream`,
      { method: "POST" },
      onToken,
      onError,
    ),

  // Actions
  listActions: () => fetch("/api/actions").then((r) => j<Action[]>(r)),
  createAction: (body: Omit<Action, "id" | "created_at">) =>
    fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => j<Action>(r)),
  updateAction: (id: UUID, body: Omit<Action, "id" | "created_at">) =>
    fetch(`/api/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => j<Action>(r)),
  deleteAction: (id: UUID) => fetch(`/api/actions/${id}`, { method: "DELETE" }),

  // Recommendations — cluster-grain streaming
  streamClusterRecommend: (
    runId: UUID,
    clusterId: number,
    onToken: (t: string) => void,
    onError?: (e: string) => void,
    refresh = false,
  ) =>
    readSSE(
      `/api/clusterings/${runId}/clusters/${clusterId}/recommend/stream?refresh=${refresh}`,
      { method: "POST" },
      onToken,
      onError,
    ),

  // Recommendations — entity-grain streaming
  streamEntityRecommend: (
    runId: UUID,
    clusterId: number,
    entityId: string,
    onToken: (t: string) => void,
    onError?: (e: string) => void,
    refresh = false,
  ) =>
    readSSE(
      `/api/clusterings/${runId}/clusters/${clusterId}/entities/${entityId}/recommend/stream?refresh=${refresh}`,
      { method: "POST" },
      onToken,
      onError,
    ),

  getClusterRecommendation: (runId: UUID, clusterId: number) =>
    fetch(`/api/clusterings/${runId}/clusters/${clusterId}/recommendation`).then((r) => j<Recommendation | null>(r)),

  // Pipelines
  listPipelines: (datasetId: UUID) =>
    fetch(`/api/datasets/${datasetId}/pipelines`).then((r) => j<Pipeline[]>(r)),
  createPipeline: (body: { dataset_id: UUID; name: string; steps: PipelineStep[] }) =>
    fetch("/api/pipelines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => j<Pipeline>(r)),
  updatePipeline: (id: UUID, steps: PipelineStep[]) =>
    fetch(`/api/pipelines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps }) })
      .then((r) => j<Pipeline>(r)),

  stepCatalogue: () => fetch("/api/preprocessing/steps").then((r) => j<unknown[]>(r)),

  // ── Config wizard ──────────────────────────────────────────────────────────

  // Step 2 — Table Explorer
  listConfigTables: (sourceId: UUID) =>
    fetch(`/config/tables?source_id=${sourceId}`).then((r) => j<ConfigTable[]>(r)),

  previewTable: (table: string, rows = 5) =>
    fetch(`/config/tables/${encodeURIComponent(table)}/preview?rows=${rows}`)
      .then((r) => j<Record<string, unknown>[]>(r)),

  selectTables: (sourceId: UUID, tables: string[]) =>
    fetch("/config/tables/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, selected_tables: tables }),
    }).then((r) => j<{ ok: boolean }>(r)),

  // Step 3 — EDA
  runEDA: (sourceId: UUID, tables?: string[]) =>
    fetch("/config/eda/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, tables: tables ?? null }),
    }).then((r) => j<{ ok: boolean; columns: number }>(r)),

  getEDA: (sourceId: UUID, table?: string) =>
    fetch(`/config/eda/${sourceId}${table ? `?table=${encodeURIComponent(table)}` : ""}`)
      .then((r) => j<ColumnAnnotation[]>(r)),

  overrideSemanticType: (sourceId: UUID, tableName: string, colName: string, semType: string) =>
    fetch("/config/eda/override", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, table_name: tableName, column_name: colName, semantic_type: semType }),
    }).then((r) => j<{ ok: boolean }>(r)),

  // Step 4 — Associations
  discoverJoins: (sourceId: UUID, tables?: string[]) =>
    fetch("/config/associations/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, tables: tables ?? null }),
    }).then((r) => j<{ ok: boolean; candidates: number }>(r)),

  getJoins: (sourceId: UUID) =>
    fetch(`/config/associations/${sourceId}`).then((r) => j<JoinSuggestion[]>(r)),

  setJoinStatus: (sourceId: UUID, joinId: UUID, status: "confirmed" | "rejected" | "pending") =>
    fetch("/config/associations/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, join_id: joinId, status }),
    }).then((r) => j<{ ok: boolean }>(r)),

  addManualJoin: (sourceId: UUID, leftTable: string, leftCol: string, rightTable: string, rightCol: string) =>
    fetch("/config/associations/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: sourceId, left_table: leftTable, left_column: leftCol,
        right_table: rightTable, right_column: rightCol,
      }),
    }).then((r) => j<{ ok: boolean }>(r)),

  // Step 5 — ML Config
  saveMLConfig: (body: MLConfigIn) =>
    fetch("/config/ml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<MLConfig>(r)),

  getMLConfig: (sourceId: UUID) =>
    fetch(`/config/ml/${sourceId}`).then((r) => j<MLConfig | null>(r)),

  buildTrainingSchema: (body: TrainingSchemaIn) =>
    fetch("/config/ml/training-schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; mlflow_run_id: string; schema: unknown }>(r)),

  // ── Table Spaces ────────────────────────────────────────────────────────────
  listSpaces: () => fetch("/spaces").then((r) => j<TableSpace[]>(r)),

  createSpace: (body: {
    name: string;
    display_name: string;
    source_id: UUID;
    tables: string[];
    primary_table?: string;
    is_default?: boolean;
  }) =>
    fetch("/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<TableSpace>(r)),

  getSpace: (spaceId: UUID) =>
    fetch(`/spaces/${spaceId}`).then((r) => j<TableSpace>(r)),

  updateSpace: (spaceId: UUID, body: Partial<{
    display_name: string;
    tables: string[];
    primary_table: string;
    is_default: boolean;
  }>) =>
    fetch(`/spaces/${spaceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<TableSpace>(r)),

  deleteSpace: (spaceId: UUID) =>
    fetch(`/spaces/${spaceId}`, { method: "DELETE" }),

  describeSpace: (spaceId: UUID) =>
    fetch(`/spaces/${spaceId}/describe`, { method: "POST" }).then((r) => j<TableSpace>(r)),

  // ── LLM Config ────────────────────────────────────────────────────────────
  listLLMFunctions: () =>
    fetch("/api/llm-config/functions").then((r) => j<LLMFunctionConfigOut[]>(r)),

  getLLMFunction: (name: string) =>
    fetch(`/api/llm-config/functions/${name}`).then((r) => j<LLMFunctionConfigOut>(r)),

  patchLLMFunction: (name: string, body: { model?: string; temperature?: number; max_tokens?: number }) =>
    fetch(`/api/llm-config/functions/${name}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<LLMFunctionConfigOut>(r)),

  listPrompts: (functionName: string) =>
    fetch(`/api/llm-config/functions/${functionName}/prompts`).then((r) => j<PromptTemplateOut[]>(r)),

  createPrompt: (functionName: string, body: {
    name: string; system_prompt: string; user_template: string;
    variables?: { name: string; description: string }[]; activate?: boolean;
  }) =>
    fetch(`/api/llm-config/functions/${functionName}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<PromptTemplateOut>(r)),

  activatePrompt: (functionName: string, promptId: UUID) =>
    fetch(`/api/llm-config/functions/${functionName}/activate/${promptId}`, { method: "POST" })
      .then((r) => j<LLMFunctionConfigOut>(r)),

  patchPrompt: (promptId: UUID, body: { name?: string; system_prompt?: string; user_template?: string }) =>
    fetch(`/api/llm-config/prompts/${promptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<PromptTemplateOut>(r)),
};

// ── Config wizard types ──────────────────────────────────────────────────────

export interface ConfigTable {
  name: string;
  row_count: number;
  col_count: number;
  selected: boolean;
}

export interface ColumnAnnotation {
  id: UUID;
  table_name: string;
  column_name: string;
  dtype: string;
  semantic_type: string;
  user_semantic_type: string | null;
  null_pct: number;
  distinct_count: number;
  distinct_pct: number;
  total_rows: number;
  stats: {
    min?: number; max?: number; mean?: number; std?: number;
    top_values?: { value: string; count: number; pct: number }[];
  };
  mlflow_run_id: string | null;
}

export interface JoinSuggestion {
  id: UUID;
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
  confidence: number;
  join_type: string;
  status: "pending" | "confirmed" | "rejected";
}

export interface MLConfigIn {
  source_id: UUID;
  mode: "exploration" | "prediction";
  exploration_config?: Record<string, unknown>;
  prediction_config?: Record<string, unknown>;
}

export interface MLConfig {
  id: UUID;
  source_id: UUID;
  mode: "exploration" | "prediction";
  exploration_config: Record<string, unknown>;
  prediction_config: Record<string, unknown>;
  mlflow_run_id: string | null;
}

export interface TrainingSchemaIn {
  source_id: UUID;
  target_table: string;
  target_column: string;
  model_type: "classification" | "regression" | "time_series";
  train_ratio?: number;
  user_overrides?: Record<string, string>;
}

// ── LLM Config ───────────────────────────────────────────────────────────────

export interface PromptVariable {
  name: string;
  description: string;
}

export interface PromptTemplateOut {
  id: UUID;
  function_name: string;
  name: string;
  system_prompt: string;
  user_template: string;
  variables: PromptVariable[];
  version: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMFunctionConfigOut {
  id: UUID;
  function_name: string;
  display_name: string;
  description: string | null;
  model: string | null;
  effective_model: string;
  temperature: number;
  max_tokens: number;
  active_prompt_id: UUID | null;
  active_prompt: PromptTemplateOut | null;
  created_at: string;
  updated_at: string;
}

// ── Table Space ───────────────────────────────────────────────────────────────

export interface TableSpace {
  id: UUID;
  name: string;
  display_name: string;
  source_id: UUID;
  source_name: string;
  tables: string[];
  primary_table: string | null;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
