"use client";

import { useState } from "react";
import { api, type Dataset, type LayaAnswer, type State } from "@/lib/api";
import { ASK_CHIPS, SURVEY_CHIPS, questionFromAsk } from "@/lib/ask";
import { fullRowState } from "@/lib/row-state";
import {
  buildSurveyState,
  layaVotesVsColumn,
  sampleRows,
  type Crosstab,
} from "@/lib/survey-stats";
import { Button, Segmented } from "./ui";

export type AskScope = "person" | "survey";

export interface AskTurn {
  q: string;
  scope: AskScope;
  answer: LayaAnswer;
  ms: number;
  tab?: Crosstab | null;
  crowd?: {
    n: number;
    labels: string[];
    rates: number[];
    vs: string;
    byVote: Record<string, Record<string, number>>;
    counts: Record<string, number>;
  } | null;
}

function prettyVote(label: string) {
  if (label === "true") return "Yes";
  if (label === "false") return "No";
  return label;
}

function formatAnswer(a: LayaAnswer) {
  if (a.type === "noul") {
    const yes = a.noul ?? 0;
    return { headline: yes >= 0.5 ? "Yes" : "No", detail: `${Math.round(yes * 100)}% yes`, tone: yes >= 0.5 ? "text-teal" : "text-rose" };
  }
  if (a.type === "choice") {
    return { headline: a.choice ?? "—", detail: a.choice && a.probabilities ? `${Math.round((a.probabilities[a.choice] ?? 0) * 100)}%` : "", tone: "text-amber" };
  }
  return { headline: String(a.score ?? "—"), detail: "score", tone: "text-amber" };
}

export function AskLaya({
  dataset,
  personState,
  disabled,
  scope,
  onScope,
}: {
  dataset: Dataset | null;
  personState: State | null;
  disabled?: boolean;
  scope: AskScope;
  onScope: (s: AskScope) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);

  async function ask(q: string) {
    const line = q.trim();
    if (!line || disabled) return;
    if (scope === "person" && !personState) return;
    if (scope === "survey" && !dataset) return;
    setBusy("Asking Laya…");
    setError(null);
    setText("");
    try {
      const t0 = performance.now();
      const qdef = questionFromAsk(line, scope);
      let tab: Crosstab | null = null;
      let state: State = personState ?? {};
      if (scope === "survey" && dataset) {
        const built = buildSurveyState(dataset, line);
        tab = built.tab;
        state = built.state;
      }
      const res = await api.evaluate(state, { ask: qdef });

      let crowd: AskTurn["crowd"] = null;
      if (scope === "survey" && dataset) {
        setBusy("Scoring 48 people…");
        const sample = sampleRows(dataset.rows, 48);
        const personQ = questionFromAsk(line, "person");
        const batch = await api.batch(sample.map((r) => fullRowState(dataset, r)), personQ);
        const rates = batch.labels.map((_, j) => batch.rows.filter((r) => r.prediction === j).length / batch.rows.length);
        const vsId = tab?.rowId ?? tab?.colId ?? "lottery";
        const vs = layaVotesVsColumn(
          dataset,
          sample.map((r) => r.id),
          batch.rows.map((r) => r.prediction),
          batch.labels,
          vsId,
        );
        crowd = {
          n: batch.rows.length,
          labels: batch.labels,
          rates,
          vs: vs?.col.id ?? vsId,
          byVote: vs?.byVote ?? {},
          counts: vs?.counts ?? {},
        };
      }

      setTurns((prev) =>
        [{ q: line, scope, answer: res.answers.ask, ms: Math.round(performance.now() - t0), tab, crowd }, ...prev].slice(0, 10),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const latest = turns[0];
  const shown = latest ? formatAnswer(latest.answer) : null;
  const chips = scope === "survey" ? SURVEY_CHIPS : ASK_CHIPS;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[15px] leading-snug text-ink/80">
          {scope === "person"
            ? "Ask about the person on the left. Laya answers yes/no, or picks between two options if you write them like Lottery A or Lottery B."
            : "Ask about the whole CSV. You get the real crosstab first, then Laya’s read of those numbers, then how Laya votes on a sample of people."}
        </p>
        <Segmented<AskScope>
          value={scope}
          onChange={onScope}
          options={[
            { value: "person", label: "This person" },
            { value: "survey", label: "Whole survey" },
          ]}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="space-y-2"
      >
        <textarea
          className="field min-h-[88px] resize-y text-[16px] leading-snug"
          placeholder={scope === "survey" ? "e.g. Do people who like rare steak take the riskier lottery?" : "e.g. Is this person a risk taker?"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => ask(c)}
              className="rounded-full border border-line px-3 py-1 text-[13px] text-ink/80 hover:border-amber/50 hover:text-amber"
            >
              {c}
            </button>
          ))}
        </div>
        <Button className="w-full !py-3 !text-[15px]" disabled={disabled || !!busy || (scope === "person" ? !personState : !dataset) || !text.trim()}>
          {busy ?? "Ask Laya"}
        </Button>
      </form>
      {error && <p className="font-mono text-[13px] text-rose">{error}</p>}
      {shown && latest && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber/30 bg-amber/5 px-5 py-5">
            <div className="text-[13px] text-dim">
              {latest.scope === "survey" ? "Whole survey · " : "This person · "}
              {latest.q}
            </div>
            <div className={`mt-1 text-[42px] font-bold leading-none tracking-tight ${shown.tone}`}>{shown.headline}</div>
            <div className="mt-2 flex flex-wrap gap-4 font-mono text-[15px] text-ink/80">
              <span>{shown.detail}</span>
              <span>confidence {Math.round((latest.answer.confidence ?? 0) * 100)}%</span>
              <span className="text-dim">{latest.ms}ms</span>
            </div>
            {latest.answer.type === "noul" && (
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-rose/25">
                <div className="bg-teal" style={{ width: `${(latest.answer.noul ?? 0) * 100}%` }} />
              </div>
            )}
            {latest.answer.probabilities && (
              <div className="mt-4 space-y-2">
                {Object.entries(latest.answer.probabilities)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-3 text-[14px]">
                      <span className="truncate font-medium">{k}</span>
                      <div className="h-2.5 rounded-sm bg-bg">
                        <div className="h-full rounded-sm bg-amber" style={{ width: `${v * 100}%` }} />
                      </div>
                      <span className="text-right font-mono tabular-nums">{Math.round(v * 100)}%</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {latest.tab && <CrosstabTable tab={latest.tab} />}

          {latest.crowd && (
            <div className="rounded-xl border border-line px-4 py-4">
              <div className="text-[13px] font-medium text-dim">Laya on {latest.crowd.n} respondents, then vs {latest.crowd.vs.replace(/_/g, " ")}</div>
              <div className="mt-2 flex flex-wrap gap-4">
                {latest.crowd.labels.map((l, i) => (
                  <div key={l}>
                    <div className="font-mono text-[22px] text-amber">{Math.round(latest.crowd!.rates[i] * 100)}%</div>
                    <div className="text-[13px] text-dim">Laya said {prettyVote(l)}</div>
                  </div>
                ))}
              </div>
              {Object.keys(latest.crowd.byVote).length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-dim">
                      <tr>
                        <th className="pb-1 font-medium">Laya said</th>
                        {Object.keys(Object.values(latest.crowd.byVote)[0] ?? {}).map((k) => (
                          <th key={k} className="px-2 pb-1 font-medium">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {latest.crowd.labels.map((l) => {
                        const tot = latest.crowd!.counts[l] || 1;
                        const row = latest.crowd!.byVote[l] ?? {};
                        return (
                          <tr key={l} className="border-t border-line/60">
                            <td className="py-1.5 font-medium">
                              {prettyVote(l)} <span className="text-dim">n={latest.crowd!.counts[l] ?? 0}</span>
                            </td>
                            {Object.entries(row).map(([k, n]) => (
                              <td key={k} className="px-2 py-1.5 font-mono tabular-nums">
                                {Math.round((n / tot) * 100)}%
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {turns.length > 1 && (
        <div className="space-y-2">
          <div className="text-[12px] font-medium uppercase tracking-wider text-dim">Earlier</div>
          {turns.slice(1).map((t, i) => {
            const f = formatAnswer(t.answer);
            return (
              <div key={i} className="flex items-baseline justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <span className="text-[14px] text-ink/80">
                  <span className="mr-2 text-[11px] text-dim">{t.scope === "survey" ? "survey" : "person"}</span>
                  {t.q}
                </span>
                <span className={`shrink-0 font-mono text-[14px] ${f.tone}`}>{f.headline}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CrosstabTable({ tab }: { tab: Crosstab }) {
  return (
    <div className="rounded-xl border border-line px-4 py-4">
      <div className="text-[13px] font-medium text-dim">
        Real CSV · {tab.rowLabel} × {tab.colLabel} · n={tab.n}
      </div>
      <p className="mt-1 text-[13px] text-ink/65">Rows are 100% — each cell is how often that column occurs in the row group. Teal is above the survey average.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-dim">
            <tr>
              <th className="pb-1 font-medium">{tab.rowLabel}</th>
              {tab.cols.map((c) => (
                <th key={c} className="px-2 pb-1 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab.rows.map((r, i) => {
              const tot = tab.counts[i].reduce((s, v) => s + v, 0);
              if (!tot) return null;
              return (
                <tr key={r} className="border-t border-line/60">
                  <td className="py-1.5 font-medium">
                    {r} <span className="text-dim">n={tot}</span>
                  </td>
                  {tab.cols.map((c, j) => {
                    const lift = tab.rowPct[i][j] - tab.colBase[j];
                    return (
                      <td
                        key={c}
                        className={`px-2 py-1.5 font-mono tabular-nums ${lift > 0.05 ? "text-teal" : lift < -0.05 ? "text-rose" : ""}`}
                      >
                        {Math.round(tab.rowPct[i][j] * 100)}%
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t border-line text-dim">
              <td className="py-1.5">all</td>
              {tab.colBase.map((p, j) => (
                <td key={j} className="px-2 py-1.5 font-mono tabular-nums">
                  {Math.round(p * 100)}%
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
