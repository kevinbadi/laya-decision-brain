"use client";

import { useMemo, useState } from "react";
import type { BatchResult } from "@/lib/api";
import { argmax, calibration, confidence, fmt, pct, softmax } from "@/lib/math";
import { Button, Pill, Stat } from "./ui";

/** Temperature that minimizes negative log-likelihood of the true labels. */
function fitTemperature(logits: number[][], truth: number[]) {
  let best = { t: 1, nll: Infinity };
  for (let t = 0.3; t <= 6; t += 0.02) {
    let nll = 0;
    logits.forEach((l, i) => {
      nll -= Math.log(Math.max(1e-12, softmax(l, t)[truth[i]]));
    });
    if (nll < best.nll) best = { t: Number(t.toFixed(2)), nll };
  }
  return best;
}

function Reliability({ bins }: { bins: ReturnType<typeof calibration>["bins"] }) {
  const S = 200;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  return (
    <svg viewBox={`-28 -8 ${S + 40} ${S + 36}`} className="w-full max-w-[280px]">
      <rect x={0} y={0} width={S} height={S} fill="none" stroke="var(--color-line)" />
      <line x1={0} y1={S} x2={S} y2={0} stroke="var(--color-faint)" strokeDasharray="3 3" />
      {bins.map((b, i) => {
        const w = S / bins.length;
        return (
          <g key={i}>
            <rect x={i * w + 1} y={S - (b.count / maxCount) * 24} width={w - 2} height={(b.count / maxCount) * 24} fill="rgb(124 184 255 / 0.25)" />
            {b.count > 0 && (
              <rect
                x={i * w + 3}
                y={S - b.accuracy * S}
                width={w - 6}
                height={b.accuracy * S}
                fill={Math.abs(b.accuracy - b.meanConf) > 0.15 ? "rgb(255 107 127 / 0.75)" : "rgb(79 209 197 / 0.75)"}
              >
                <title>{`confidence ${pct(b.lo, 0)}–${pct(b.hi, 0)}: ${b.count} rows, accuracy ${pct(b.accuracy)}, mean top-p ${pct(b.meanConf)}`}</title>
              </rect>
            )}
          </g>
        );
      })}
      {[0, 0.5, 1].map((v) => (
        <g key={v} className="font-mono" fontSize={9} fill="var(--color-dim)">
          <text x={v * S} y={S + 14} textAnchor="middle">
            {v}
          </text>
          <text x={-6} y={S - v * S + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <text x={S / 2} y={S + 27} textAnchor="middle" fontSize={9} fill="var(--color-dim)" className="font-mono">
        predicted top-1 probability
      </text>
    </svg>
  );
}

export function BatchView({
  result,
  truths,
  rowIds,
  onInspect,
}: {
  result: BatchResult;
  truths: string[];
  rowIds: string[];
  onInspect: (rowId: string) => void;
}) {
  const { labels } = result;
  const [temp, setTemp] = useState(result.temperature.applied);
  const [filter, setFilter] = useState<"all" | "wrong" | "right">("all");

  const truthIdx = truths.map((t) => labels.indexOf(t));
  const valid = truthIdx.map((t) => t >= 0);

  const stats = useMemo(() => {
    const probs = result.rows.map((r) => softmax(r.logits, temp));
    const preds = probs.map(argmax);
    const correct = preds.map((p, i) => p === truthIdx[i]);
    const idx = result.rows.map((_, i) => i).filter((i) => valid[i]);
    const acc = idx.filter((i) => correct[i]).length / Math.max(1, idx.length);
    const counts = labels.map((_, j) => idx.filter((i) => truthIdx[i] === j).length);
    const majority = argmax(counts);
    const cal = calibration(
      idx.map((i) => probs[i][preds[i]]),
      idx.map((i) => correct[i]),
    );
    const matrix = labels.map((_, t) => labels.map((_, p) => idx.filter((i) => truthIdx[i] === t && preds[i] === p).length));
    const predCounts = labels.map((_, j) => idx.filter((i) => preds[i] === j).length);
    const meanConf = idx.reduce((a, i) => a + confidence(probs[i]), 0) / Math.max(1, idx.length);
    const meanTop = idx.reduce((a, i) => a + probs[i][preds[i]], 0) / Math.max(1, idx.length);
    const nll = idx.reduce((a, i) => a - Math.log(Math.max(1e-12, probs[i][truthIdx[i]])), 0) / Math.max(1, idx.length);
    const actRate = idx.filter((i) => result.rows[i].act >= 0.5).length / Math.max(1, idx.length);
    return { probs, preds, correct, acc, counts, majority, baseline: counts[majority] / Math.max(1, idx.length), cal, matrix, predCounts, meanConf, meanTop, nll, actRate, n: idx.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, temp, truths]);

  const fitted = useMemo(
    () =>
      fitTemperature(
        result.rows.filter((_, i) => valid[i]).map((r) => r.logits),
        truthIdx.filter((t) => t >= 0),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, truths],
  );

  const maxCell = Math.max(1, ...stats.matrix.flat());
  const lift = stats.acc - stats.baseline;

  const rows = result.rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => valid[i] && (filter === "all" || (filter === "wrong") !== stats.correct[i]));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="accuracy" value={pct(stats.acc)} tone={lift > 0.02 ? "text-teal" : lift < -0.02 ? "text-rose" : "text-amber"} hint={`${stats.n} rows`} />
        <Stat
          label="majority baseline"
          value={pct(stats.baseline)}
          hint={`always “${labels[stats.majority]}” · ${lift >= 0 ? "+" : ""}${fmt(lift * 100, 1)}pt`}
        />
        <Stat label="ECE" value={fmt(stats.cal.ece, 3)} tone={stats.cal.ece > 0.1 ? "text-rose" : "text-teal"} hint="calibration error, lower is better" />
        <Stat label="log loss" value={fmt(stats.nll, 3)} hint={`uniform = ${fmt(Math.log(labels.length), 3)}`} />
        <Stat label="mean top-p" value={pct(stats.meanTop)} hint={`confidence ${pct(stats.meanConf)}`} />
        <Stat label="gate acts on" value={pct(stats.actRate)} hint={`${result.timing_ms}ms total`} />
      </div>

      <div className="rounded-lg border border-line bg-raised/60 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="label">temperature</span>
          <input type="range" min={0.3} max={6} step={0.01} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="min-w-40 flex-1" />
          <span className="w-12 font-mono text-[13px] text-amber tabular-nums">{fmt(temp, 2)}</span>
          <Button variant="ghost" onClick={() => setTemp(fitted.t)} title="Temperature that minimizes log loss on this sample">
            Fit to data → {fmt(fitted.t, 2)}
          </Button>
          <button type="button" className="font-mono text-[11px] text-dim hover:text-ink" onClick={() => setTemp(result.temperature.applied)}>
            shipped {fmt(result.temperature.applied, 2)}
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-dim">
          Temperature only changes confidence and calibration, never the predicted answer. To raise accuracy, change the instructions, the option wording, or which fields are included, then re-run.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="label mb-2">confusion matrix · rows = truth, columns = prediction</div>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[3px] font-mono text-[11px]">
              <thead>
                <tr>
                  <th />
                  {labels.map((l) => (
                    <th key={l} className="max-w-[88px] truncate px-1 pb-1 text-left font-normal text-dim" title={l}>
                      {l}
                    </th>
                  ))}
                  <th className="pl-2 text-left font-normal text-dim">n</th>
                </tr>
              </thead>
              <tbody>
                {labels.map((l, t) => (
                  <tr key={l}>
                    <td className="max-w-[120px] truncate pr-2 text-right text-dim" title={l}>
                      {l}
                    </td>
                    {labels.map((_, p) => {
                      const v = stats.matrix[t][p];
                      const a = v / maxCell;
                      return (
                        <td
                          key={p}
                          className="h-9 w-14 rounded text-center tabular-nums"
                          style={{
                            background: t === p ? `rgb(79 209 197 / ${0.08 + a * 0.7})` : `rgb(255 107 127 / ${v ? 0.06 + a * 0.6 : 0.03})`,
                            color: a > 0.5 ? "var(--color-bg)" : "var(--color-ink)",
                          }}
                        >
                          {v || ""}
                        </td>
                      );
                    })}
                    <td className="pl-2 text-dim">{stats.counts[t]}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pr-2 text-right text-dim">predicted</td>
                  {stats.predCounts.map((c, i) => (
                    <td key={i} className="text-center text-amber/80">
                      {c}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="label mb-2">reliability · bar height = accuracy, diagonal = perfect</div>
          <Reliability bins={stats.cal.bins} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="label">rows · click to open in the brain view</div>
          <div className="flex gap-1">
            {(["all", "wrong", "right"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] ${filter === f ? "bg-raised text-amber" : "text-dim hover:text-ink"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full font-mono text-[11.5px]">
            <thead className="sticky top-0 bg-panel text-left text-dim">
              <tr>
                <th className="px-3 py-1.5 font-normal">row</th>
                <th className="px-3 py-1.5 font-normal">truth</th>
                <th className="px-3 py-1.5 font-normal">predicted</th>
                <th className="px-3 py-1.5 font-normal">p(pred)</th>
                <th className="px-3 py-1.5 font-normal">p(truth)</th>
                <th className="px-3 py-1.5 font-normal">gate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, i }) => (
                <tr key={i} onClick={() => onInspect(rowIds[i])} className="cursor-pointer border-t border-line/60 hover:bg-raised">
                  <td className="px-3 py-1 text-dim">{rowIds[i]}</td>
                  <td className="px-3 py-1 text-teal">{truths[i]}</td>
                  <td className={`px-3 py-1 ${stats.correct[i] ? "text-teal" : "text-rose"}`}>{labels[stats.preds[i]]}</td>
                  <td className="px-3 py-1 tabular-nums">{pct(stats.probs[i][stats.preds[i]])}</td>
                  <td className="px-3 py-1 tabular-nums">{pct(stats.probs[i][truthIdx[i]])}</td>
                  <td className="px-3 py-1">{r.act >= 0.5 ? <Pill tone="teal">act</Pill> : <Pill tone="rose">escalate</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
