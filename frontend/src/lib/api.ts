export type State = string | Record<string, unknown> | unknown[];

export type QuestionType = "choice" | "score" | "noul";

export interface QuestionDef {
  type: QuestionType;
  instructions: string;
  /** choice: option -> description; score: ordered levels; noul: optional {true, false} descriptions */
  criteria?: Record<string, string | null> | string[];
}

export type Questions = Record<string, QuestionDef>;

export interface Temperature {
  bucket: string;
  source: string;
  shipped: number;
  applied: number;
  clamped: boolean;
}

export interface Token {
  t: string;
  role: "cls" | "instruction" | "sep" | "marker" | "option" | "state";
  opt: number | null;
}

export interface Attribution {
  label: string;
  text: string;
  support: number;
  tvd: number;
  top_without: number;
  flipped: boolean;
  probs_without: number[];
  score_shift?: number;
}

export interface LayaAnswer {
  type: QuestionType;
  choice?: string;
  score?: number;
  noul?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
  action: { act_probability: number };
}

export interface QuestionTrace {
  question: QuestionDef;
  labels: string[];
  options_rendered: string[];
  answer: LayaAnswer;
  logits: number[];
  probs_uncalibrated: number[];
  probs: number[];
  temperature: Temperature;
  confidence: { value: number; entropy_norm: number };
  act_gate: {
    act: number;
    escalate: number | null;
    features: { top1: number; margin: number; entropy_norm: number; k_scaled: number };
  };
  sequence: {
    tokens: Token[];
    state_start: number;
    n_state_tokens: number;
    length: number;
    markers: number[];
    state_tokens_total: number;
    state_tokens_truncated: number;
  };
  order_check?: { probs_reversed_order: number[]; answer_changed: boolean; tvd: number };
  attribution: Attribution[] | null;
}

export interface Trace {
  model: string;
  state_kind: string;
  state_serialized: string;
  questions: Record<string, QuestionTrace>;
  order: string[];
  timing_ms: { forward: number; diagnostics: number };
  passes: { base: number; diagnostic: number };
  usage: { input_tokens: number; output_tokens: number };
}

export interface BatchRow {
  logits: number[];
  probs: number[];
  prediction: number;
  confidence: number;
  act: number;
}

export interface BatchResult {
  labels: string[];
  temperature: Temperature;
  rows: BatchRow[];
  timing_ms: number;
}

export interface ModelInfo {
  encoder: string;
  head_layers: number;
  max_len: number;
  head_max_len: number;
  act_costs: Record<string, number>;
  cost_wrong_act: number;
  training: Record<string, unknown>;
  device: string;
  dtype: string;
  parameters: number;
  temperature: {
    by_type_shipped: Record<string, number>;
    by_type_applied: Record<string, number>;
    by_bucket_shipped: Record<string, number>;
    by_bucket_applied: Record<string, number>;
  };
}

export interface Preset {
  id: string;
  name: string;
  state: State;
  questions: Questions;
}

export interface DatasetColumn {
  id: string;
  question: string;
  ordinal: boolean;
  options: { value: string; count: number }[];
}

export interface DatasetRow {
  id: string;
  answers: Record<string, string>;
}

export interface Dataset {
  id: string;
  name: string;
  subject: string;
  id_column: string;
  default_target: string | null;
  columns: DatasetColumn[];
  rows: DatasetRow[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  rows: number;
  columns: number;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string; model: ModelInfo }>("/health"),
  evaluate: (state: State, questions: Questions) =>
    post<{ answers: Record<string, LayaAnswer> }>("/evaluate", { state, questions }),
  inspect: (state: State, questions: Questions, opts = { attribution: true, order_check: true }) =>
    post<Trace>("/inspect", { state, questions, ...opts }),
  batch: (states: State[], question: QuestionDef) => post<BatchResult>("/batch", { states, question }),
  presets: () => request<Preset[]>("/presets"),
  datasets: () => request<DatasetSummary[]>("/datasets"),
  dataset: (id: string) => request<Dataset>(`/datasets/${id}`),
};
