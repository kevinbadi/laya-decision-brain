"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type BatchResult,
  type Dataset,
  type DatasetColumn,
  type DatasetRow,
  type ModelInfo,
  type QuestionDef,
  type Questions,
  type State,
  type Trace,
} from "@/lib/api";
import { BatchView } from "@/components/BatchView";
import { BrainView } from "@/components/BrainView";
import { QuestionEditor } from "@/components/QuestionEditor";
import { AppNav } from "@/components/AppNav";
import { AskLaya, type AskScope } from "@/components/AskLaya";
import { Button, Panel, Pill } from "@/components/ui";
import { fullRowState, rowState, shortLabel } from "@/lib/row-state";

const DATASET_ID = "steak-risk";
const BATCH_CHUNK = 24;

const OPTION_HINTS: Record<string, Record<string, string>> = {
  steak_doneness: {
    Rare: "cool red center",
    "Medium rare": "warm red center",
    Medium: "warm pink center",
    "Medium Well": "slightly pink center",
    Well: "brown throughout, no pink",
  },
  lottery: {
    "Lottery A": "riskier: 50% chance to win $100",
    "Lottery B": "safer: 90% chance to win $20",
  },
};

function targetQuestion(col: DatasetColumn, subject: string): QuestionDef {
  const hints = OPTION_HINTS[col.id] ?? {};
  return {
    type: "choice",
    instructions: `Based on this ${subject}'s other answers, predict their answer to: "${col.question}"`,
    criteria: Object.fromEntries(col.options.map((o) => [o.value, hints[o.value] ?? null])),
  };
}

/** Map a raw CSV value to the label Laya will output for this question. */
function truthLabel(q: QuestionDef | undefined, col: DatasetColumn | undefined, value: string | undefined) {
  if (!q || !col || value === undefined) return undefined;
  if (q.type === "choice") return value;
  if (q.type === "score") {
    const i = col.options.findIndex((o) => o.value === value);
    return i >= 0 ? String(i) : undefined;
  }
  return undefined;
}

export default function Home() {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [askScope, setAskScope] = useState<AskScope>("person");

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [target, setTarget] = useState<string>("");
  const [rowId, setRowId] = useState<string>("");
  const [excluded, setExcluded] = useState<string[]>([]);

  const [questions, setQuestions] = useState<Questions>({});

  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceTruths, setTraceTruths] = useState<Record<string, string>>({});
  const [traceVersion, setTraceVersion] = useState(0);
  const [tracing, setTracing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchN, setBatchN] = useState(100);
  const [batch, setBatch] = useState<{ result: BatchResult; truths: string[]; rowIds: string[] } | null>(null);
  const [batchProgress, setBatchProgress] = useState<number | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setModel(h.model))
      .catch(() => setOffline(true));
    api
      .dataset(DATASET_ID)
      .then((ds) => {
        setDataset(ds);
        const t = ds.default_target ?? ds.columns[0].id;
        const col = ds.columns.find((c) => c.id === t)!;
        setTarget(t);
        setQuestions({ [t]: targetQuestion(col, ds.subject) });
        setRowId(ds.rows.find((r) => r.answers[t])?.id ?? "");
      })
      .catch(() => {});
  }, []);

  const targetCol = dataset?.columns.find((c) => c.id === target);
  const rows = dataset?.rows ?? [];
  const row = rows.find((r) => r.id === rowId) ?? rows[0];
  const rowIndex = row ? rows.indexOf(row) : -1;
  const batchEligible = useMemo(() => {
    if (!dataset) return [];
    return dataset.rows.filter((r) => r.answers[target]);
  }, [dataset, target]);

  const currentState: State | null = useMemo(
    () => (dataset && row ? rowState(dataset, row, target, excluded) : null),
    [dataset, row, target, excluded],
  );

  const askState: State | null = useMemo(
    () => (dataset && row ? fullRowState(dataset, row) : null),
    [dataset, row],
  );

  const runTrace = useCallback(async (state: State, qs: Questions, truths: Record<string, string>) => {
    setTracing(true);
    setError(null);
    try {
      const t = await api.inspect(state, qs);
      setTrace(t);
      setTraceTruths(truths);
      setTraceVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTracing(false);
    }
  }, []);

  const truthsFor = useCallback(
    (r: DatasetRow | undefined): Record<string, string> => {
      const label = truthLabel(questions[target], targetCol, r?.answers[target]);
      return label !== undefined ? { [target]: label } : {};
    },
    [questions, target, targetCol],
  );

  const traceCurrent = () => {
    if (!currentState || Object.keys(questions).length === 0) return;
    runTrace(currentState, questions, truthsFor(row));
  };

  const chooseTarget = (t: string) => {
    if (!dataset) return;
    const col = dataset.columns.find((c) => c.id === t)!;
    setTarget(t);
    setExcluded((ex) => ex.filter((e) => e !== t));
    setQuestions({ [t]: targetQuestion(col, dataset.subject) });
    setBatch(null);
    if (!dataset.rows.find((r) => r.id === rowId)?.answers[t]) setRowId(dataset.rows.find((r) => r.answers[t])?.id ?? "");
  };

  const step = (delta: number) => {
    if (!rows.length) return;
    setRowId(rows[(rowIndex + delta + rows.length) % rows.length].id);
  };

  const inspectRow = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!dataset || !r) return;
    setRowId(id);
    runTrace(rowState(dataset, r, target, excluded), questions, truthsFor(r));
  };

  const runBatch = async () => {
    const q = questions[target];
    if (!dataset || !q) return;
    const n = Math.min(batchN, batchEligible.length);
    const stride = batchEligible.length / n;
    const sample = Array.from({ length: n }, (_, i) => batchEligible[Math.floor(i * stride)]);
    setError(null);
    setBatchProgress(0);
    try {
      const parts: BatchResult[] = [];
      for (let i = 0; i < sample.length; i += BATCH_CHUNK) {
        const chunk = sample.slice(i, i + BATCH_CHUNK);
        parts.push(await api.batch(chunk.map((r) => rowState(dataset, r, target, excluded)), q));
        setBatchProgress((i + chunk.length) / sample.length);
      }
      setBatch({
        result: {
          ...parts[0],
          rows: parts.flatMap((p) => p.rows),
          timing_ms: Math.round(parts.reduce((a, p) => a + p.timing_ms, 0)),
        },
        truths: sample.map((r) => truthLabel(q, targetCol, r.answers[target]) ?? ""),
        rowIds: sample.map((r) => r.id),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchProgress(null);
    }
  };

  const busy = tracing || batchProgress !== null;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-5 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[26px] font-bold tracking-[-0.03em]">
            laya<span className="text-amber">.</span>
          </h1>
          <span className="text-[14px] text-dim">survey lab</span>
        </div>
        <AppNav here="survey" />
        <div className="flex flex-wrap items-center gap-1.5">
          {model ? (
            <>
              <Pill tone="teal">● online</Pill>
              <Pill>{model.encoder.split("/").pop()}</Pill>
              <Pill>{(model.parameters / 1e6).toFixed(0)}M params</Pill>
              <Pill>
                {model.device} · {model.dtype}
              </Pill>
              <Pill>ctx {model.max_len}</Pill>
              <Pill>+{model.head_layers} head layers</Pill>
            </>
          ) : offline ? (
            <Pill tone="rose">backend offline: start it with npm run dev:backend</Pill>
          ) : (
            <Pill>connecting…</Pill>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[410px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <p className="rounded-xl border border-line bg-panel px-4 py-3 text-[14px] leading-snug text-ink/75">
            <strong className="text-ink">How this works.</strong>{" "}
            {askScope === "survey"
              ? "Ask about the whole CSV. You’ll see the real crosstab, then Laya’s read of those numbers, then how Laya votes on a sample of people. The math below is for the respondent on the left."
              : "Pick a respondent and ask about them. Switch to Whole survey to look for correlations. See the math sits under Ask — same person, opened up."}
          </p>
          <Panel kicker="who you're asking about" title={askScope === "survey" ? "The survey" : "This respondent"}>
            {dataset && targetCol && row && askScope === "survey" ? (
              <div className="space-y-3">
                <div className="text-[14px] text-ink/80">{dataset.name}</div>
                <div className="font-mono text-[28px] text-amber">{dataset.rows.length}</div>
                <div className="text-[13px] text-dim">respondents · {dataset.columns.length} questions</div>
                <div className="space-y-2">
                  {dataset.columns.slice(0, 8).map((c) => {
                    const n = c.options.reduce((s, o) => s + o.count, 0);
                    const top = [...c.options].sort((a, b) => b.count - a.count)[0];
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="truncate text-dim">{shortLabel(c)}</span>
                        <span className="shrink-0 font-mono text-ink">
                          {top ? `${top.value} ${n ? Math.round((top.count / n) * 100) : 0}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : dataset && targetCol && row ? (
              <div className="space-y-3">
                <div className="text-[13px] text-dim">{dataset.name}</div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" className="!px-2.5 !py-1.5" onClick={() => step(-1)}>
                    ←
                  </Button>
                  <select className="field font-mono !text-[12px]" value={row.id} onChange={(e) => setRowId(e.target.value)}>
                    {rows.map((r, i) => (
                      <option key={r.id} value={r.id}>
                        #{i + 1} · respondent {r.id}
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" className="!px-2.5 !py-1.5" onClick={() => step(1)}>
                    →
                  </Button>
                  <Button
                    variant="ghost"
                    className="!px-2.5 !py-1.5"
                    title="Random respondent"
                    onClick={() => setRowId(rows[Math.floor(Math.random() * rows.length)].id)}
                  >
                    ⤨
                  </Button>
                </div>
                <div className="space-y-1">
                  {dataset.columns.map((c) => {
                    const v = row.answers[c.id];
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-2.5 py-1.5 text-[13px]">
                        <span className="truncate text-dim">{shortLabel(c)}</span>
                        <span className="shrink-0 font-mono text-ink">{v || "—"}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2 border-t border-line pt-3">
                  <label className="block text-[12px] font-medium text-amber/80">When tracing, hide this column and predict it</label>
                  <select className="field" value={target} onChange={(e) => chooseTarget(e.target.value)}>
                    {dataset.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {shortLabel(c)} ({c.options.length} options)
                      </option>
                    ))}
                  </select>
                  <div className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 text-[13px]">
                    Ground truth: <span className="font-mono text-teal">{row.answers[target]}</span>
                  </div>
                  <div className="text-[12px] text-dim">Click a field below to hide it from the model.</div>
                  <div className="space-y-1">
                    {dataset.columns
                      .filter((c) => c.id !== target)
                      .map((c) => {
                        const off = excluded.includes(c.id);
                        const v = row.answers[c.id];
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setExcluded((ex) => (off ? ex.filter((e) => e !== c.id) : [...ex, c.id]))}
                            className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left text-[12px] transition ${
                              off ? "border-line/50 text-faint line-through" : v ? "border-line hover:border-faint" : "border-line/40 text-faint"
                            }`}
                          >
                            <span className="truncate">{shortLabel(c)}</span>
                            <span className={`shrink-0 font-mono ${off ? "" : v ? "text-ink" : "italic"}`}>{v ?? "blank"}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel kicker="input" title="Questions" right={<span className="font-mono text-[11px] text-dim">{Object.keys(questions).length} in one pass</span>}>
            <QuestionEditor questions={questions} onChange={setQuestions} lockedIds={[target]} />
          </Panel>

          <div className="sticky bottom-0 space-y-2 rounded-xl border border-line bg-panel/95 p-3 backdrop-blur">
            <Button className={`w-full ${tracing ? "scanning" : ""}`} onClick={traceCurrent} disabled={busy || !currentState || offline}>
              {tracing ? "Tracing…" : "Trace decision"}
            </Button>
            <div className="flex items-center gap-2">
              <select className="field !w-auto !py-1.5 font-mono !text-[12px]" value={batchN} onChange={(e) => setBatchN(Number(e.target.value))}>
                {[50, 100, 200, 10000].map((n) => (
                  <option key={n} value={n}>
                    {n >= batchEligible.length || n === 10000 ? `all ${batchEligible.length}` : n} rows
                  </option>
                ))}
              </select>
              <Button variant="ghost" className="flex-1" onClick={runBatch} disabled={busy || offline}>
                {batchProgress !== null ? `Running… ${Math.round(batchProgress * 100)}%` : `Run batch on “${target}”`}
              </Button>
            </div>
            {batchProgress !== null && (
              <div className="h-1 overflow-hidden rounded bg-bg">
                <div className="h-full bg-amber transition-[width]" style={{ width: `${batchProgress * 100}%` }} />
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {error && <div className="rounded-lg border border-rose/40 bg-rose/5 px-3 py-2 font-mono text-[12px] text-rose">{error}</div>}

          <Panel kicker="talk to the model" title="Ask Laya">
            <AskLaya dataset={dataset} personState={askState} disabled={offline || busy} scope={askScope} onScope={setAskScope} />
          </Panel>

          <Panel
            kicker="one decision, every step"
            title="See the math"
            right={
              <Button className={tracing ? "scanning" : ""} onClick={traceCurrent} disabled={busy || !currentState || offline}>
                {tracing ? "Tracing…" : trace ? "Retrace" : "Trace this person"}
              </Button>
            }
          >
            {trace ? (
              <div className={tracing ? "pointer-events-none opacity-50 transition" : "transition"}>
                <BrainView trace={trace} truths={traceTruths} version={traceVersion} />
                <details className="mt-6">
                  <summary className="label cursor-pointer hover:text-ink">raw Laya output (same as POST /evaluate)</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-bg p-3 font-mono text-[11px] text-ink/80">
                    {JSON.stringify(
                      { answers: Object.fromEntries(trace.order.map((id) => [id, trace.questions[id].answer])), usage: trace.usage },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ) : (
              <div className={`flex h-56 items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-dim ${tracing ? "scanning" : ""}`}>
                {tracing
                  ? "Reading the state and scoring every option…"
                  : offline
                    ? "The backend is offline."
                    : "Trace this person to open the logits, temperature, and attribution for the question on the left."}
              </div>
            )}
          </Panel>

          {(batch || batchProgress !== null) && (
            <Panel kicker="the same question across many respondents" title="Batch lab">
              {batch ? (
                <BatchView result={batch.result} truths={batch.truths} rowIds={batch.rowIds} onInspect={inspectRow} />
              ) : (
                <div className={`flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-dim ${batchProgress !== null ? "scanning" : ""}`}>
                  Scoring respondents…
                </div>
              )}
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}
