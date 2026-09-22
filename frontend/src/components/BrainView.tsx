"use client";

import { useMemo, useState } from "react";
import type { QuestionTrace, Token, Trace } from "@/lib/api";
import { argmax, confidence, fmt, pct, softmax } from "@/lib/math";
import { Bar, Pill, Stage, Stat } from "./ui";

const ROLE_STYLE: Record<Token["role"], string> = {
  cls: "text-faint",
  sep: "text-faint",
  instruction: "text-amber",
  marker: "",
  option: "text-sky",
  state: "text-ink/70",
};

function TokenStrip({ trace, truthIndex }: { trace: QuestionTrace; truthIndex?: number }) {
  const [showState, setShowState] = useState(true);
  const { tokens, length, n_state_tokens, state_tokens_truncated } = trace.sequence;
  const visible = showState ? tokens : tokens.filter((t) => t.role !== "state");
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <Pill tone="amber">instruction</Pill>
        <Pill>◆ [MASK] option slot</Pill>
        <span className="font-mono text-sky">option text</span>
        <span className="font-mono text-ink/70">state</span>
        <span className="ml-auto flex items-center gap-3 font-mono text-dim">
          <span>
            {length}/512 tokens · state {n_state_tokens}
          </span>
          <button type="button" className="text-amber/80 hover:text-amber" onClick={() => setShowState((s) => !s)}>
            {showState ? "hide state" : "show state"}
          </button>
        </span>
      </div>
      {state_tokens_truncated > 0 && (
        <div className="mb-2 rounded border border-rose/40 bg-rose/5 px-2 py-1 text-[12px] text-rose">
          {state_tokens_truncated} state tokens were cut off: the model never saw the end of the state.
        </div>
      )}
      <div className="max-h-56 overflow-auto rounded bg-bg p-2.5 font-mono text-[11.5px] leading-[1.9] whitespace-pre-wrap break-words">
        {visible.map((t, i) => {
          if (t.role === "marker") {
            const isTruth = truthIndex === t.opt;
            return (
              <span
                key={i}
                title={`[MASK] for option ${t.opt}: its hidden state is scored to produce this option's logit`}
                className={`mx-0.5 rounded px-1 py-[1px] text-[10px] ${isTruth ? "bg-teal/20 text-teal" : "bg-amber/15 text-amber"}`}
              >
                ◆{t.opt}
              </span>
            );
          }
          if (t.role === "cls" || t.role === "sep")
            return (
              <span key={i} className="mx-0.5 text-[10px] text-faint">
                {t.role === "cls" ? "[CLS]" : "[SEP]"}
              </span>
            );
          return (
            <span key={i} className={`${ROLE_STYLE[t.role]} hover:bg-ink/10`}>
              {t.t}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function optionLabel(trace: QuestionTrace, i: number) {
  const q = trace.question;
  if (q.type === "score") return `${i} · ${(q.criteria as string[])[i]}`;
  return trace.labels[i];
}

function QuestionBrain({ trace, truth }: { trace: QuestionTrace; truth?: string }) {
  const k = trace.logits.length;
  const [temp, setTemp] = useState(trace.temperature.applied);

  const whatIf = useMemo(() => softmax(trace.logits, temp), [trace.logits, temp]);
  const tuned = Math.abs(temp - trace.temperature.applied) > 1e-3;
  const probs = tuned ? whatIf : trace.probs;
  const top = argmax(probs);
  const truthIndex = truth !== undefined ? trace.labels.indexOf(truth) : undefined;
  const conf = confidence(probs);

  const minL = Math.min(...trace.logits);
  const maxL = Math.max(...trace.logits);
  const span = Math.max(1e-6, maxL - minL);

  const attributions = trace.attribution ?? [];
  const maxTvd = Math.max(0.001, ...attributions.map((a) => a.tvd));
  const maxSupport = Math.max(0.001, ...attributions.map((a) => Math.abs(a.support)));

  const mark = (i: number) =>
    truthIndex === i ? (
      <span className="font-mono text-[10px] text-teal" title="ground truth">
        ●
      </span>
    ) : null;

  const answerText =
    trace.question.type === "noul"
      ? probs[1] >= 0.5
        ? "true"
        : "false"
      : trace.question.type === "score"
        ? `${fmt(probs.reduce((a, p, i) => a + p * i, 0), 2)} / ${k - 1}`
        : trace.labels[top];

  return (
    <div className="space-y-5">
      <Stage
        n={1}
        title="Read: build the input sequence"
        caption={
          <>
            Each question becomes its own sequence: <span className="font-mono">[CLS] {trace.question.type} question: instructions [SEP] ◆opt… [SEP] state [SEP]</span>.
            One ModernBERT pass reads everything together. There is no text generation.
          </>
        }
      >
        <TokenStrip trace={trace} truthIndex={truthIndex} />
      </Stage>

      <Stage
        n={2}
        title="Score: one raw logit per option"
        caption="The hidden state at each ◆ slot goes through the scorer MLP. Higher means preferred. Only the differences between logits matter."
        delay={60}
      >
        {trace.logits.map((l, i) => (
          <Bar
            key={i}
            label={optionLabel(trace, i)}
            value={(l - minL) / span}
            tone={i === argmax(trace.logits) ? "amber" : "dim"}
            suffix={fmt(l, 3)}
            mark={mark(i)}
            strong={i === argmax(trace.logits)}
          />
        ))}
        <div className="mt-2 font-mono text-[11px] text-dim">
          spread {fmt(span, 3)} · top gap {fmt(k > 1 ? [...trace.logits].sort((a, b) => b - a)[0] - [...trace.logits].sort((a, b) => b - a)[1] : 0, 3)}
        </div>
      </Stage>

      <Stage
        n={3}
        title="Calibrate: divide by temperature, then softmax"
        caption={
          <>
            Temperature comes from bucket <span className="font-mono text-ink">{trace.temperature.bucket}</span> ({trace.temperature.source}). Drag the slider to see how a
            different temperature reshapes the probabilities. The answer never changes, only the confidence.
          </>
        }
        right={
          <div className="flex gap-1.5">
            <Pill>shipped T={fmt(trace.temperature.shipped, 3)}</Pill>
            {trace.temperature.clamped && <Pill tone="rose">clamped</Pill>}
          </div>
        }
        delay={120}
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="label w-6">T</span>
          <input
            type="range"
            min={0.3}
            max={5}
            step={0.01}
            value={temp}
            onChange={(e) => setTemp(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-14 text-right font-mono text-[13px] text-amber tabular-nums">{fmt(temp, 2)}</span>
          {tuned && (
            <button type="button" className="font-mono text-[11px] text-dim hover:text-ink" onClick={() => setTemp(trace.temperature.applied)}>
              reset
            </button>
          )}
        </div>
        {probs.map((p, i) => (
          <Bar
            key={i}
            label={optionLabel(trace, i)}
            value={p}
            ghost={trace.probs_uncalibrated[i]}
            tone={i === top ? "amber" : "dim"}
            suffix={pct(p)}
            mark={mark(i)}
            strong={i === top}
          />
        ))}
        <div className="mt-2 text-[11px] text-dim">
          Grey outline: probability before calibration (T = 1). Filled bar: {tuned ? "what-if" : "Laya's output"} at T = {fmt(temp, 2)}.
        </div>
      </Stage>

      <Stage n={4} title="Decide" caption="The final answer and confidence, where confidence = 1 − entropy / log(k)." delay={180}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="answer"
            value={answerText}
            tone={truthIndex !== undefined && trace.question.type !== "score" ? (truthIndex === top ? "text-teal" : "text-rose") : "text-amber"}
            hint={truth !== undefined ? `truth: ${truth}` : tuned ? "what-if temperature" : undefined}
          />
          <Stat label="confidence" value={pct(conf)} hint={conf < 0.2 ? "close to a coin flip" : conf > 0.7 ? "decisive" : "uncertain"} />
          <Stat label="top probability" value={pct(probs[top])} hint={`chance baseline ${pct(1 / k)}`} />
          <Stat label="options" value={k} hint={trace.question.type} />
        </div>
      </Stage>

      <Stage
        n={5}
        title="Gate: act or escalate"
        caption="A separate head decides whether the answer is safe to act on or should go to a human (escalation cost 0.5). It sees the [CLS] embedding plus the four uncalibrated signals below."
        delay={240}
      >
        <div className="mb-3 flex h-6 overflow-hidden rounded font-mono text-[11px]">
          <div className="flex items-center bg-teal/80 px-2 text-bg" style={{ width: `${trace.act_gate.act * 100}%` }}>
            {trace.act_gate.act > 0.12 && `act ${pct(trace.act_gate.act)}`}
          </div>
          <div className="flex flex-1 items-center justify-end bg-rose/70 px-2 text-bg">
            {(trace.act_gate.escalate ?? 0) > 0.12 && `escalate ${pct(trace.act_gate.escalate ?? 0)}`}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="top-1 prob" value={fmt(trace.act_gate.features.top1)} />
          <Stat label="margin" value={fmt(trace.act_gate.features.margin)} />
          <Stat label="entropy (norm)" value={fmt(trace.act_gate.features.entropy_norm)} />
          <Stat label="k / 255" value={fmt(trace.act_gate.features.k_scaled, 4)} />
        </div>
        {trace.act_gate.act > 0.9 && trace.confidence.value < 0.2 && (
          <p className="mt-3 text-[12px] text-rose">
            The gate says act, but confidence is near zero. The gate is overconfident on this question type, so gate on confidence as well.
          </p>
        )}
      </Stage>

      <Stage
        n={6}
        title="Evidence: what drove the decision"
        caption="Each state field is removed in turn and the question re-run. Support is how much the chosen answer's probability drops without that field: teal means the field argued for the answer, rose means it argued against. Shift (TVD) is how much the whole distribution moved."
        delay={300}
      >
        {attributions.length === 0 ? (
          <p className="text-[12.5px] text-dim">The state has fewer than two removable parts, so there is nothing to compare.</p>
        ) : (
          <div className="space-y-0.5">
            <div className="grid grid-cols-[minmax(0,14rem)_1fr_1fr_5.5rem] gap-3 pb-1">
              <span className="label">field</span>
              <span className="label">support for “{trace.labels[argmax(trace.probs)]}”</span>
              <span className="label">shift (tvd)</span>
              <span className="label text-right">if removed</span>
            </div>
            {attributions.map((a) => (
              <div key={a.label} className="grid grid-cols-[minmax(0,14rem)_1fr_1fr_5.5rem] items-center gap-3 py-[3px]" title={a.text}>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-ink/85">{a.label}</div>
                  <div className="truncate font-mono text-[10.5px] text-dim">{a.text}</div>
                </div>
                <div className="relative h-2.5 rounded-sm bg-bg">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                  <div
                    className={`absolute inset-y-0 ${a.support >= 0 ? "left-1/2 bg-teal" : "right-1/2 bg-rose"}`}
                    style={{ width: `${(Math.abs(a.support) / maxSupport) * 50}%` }}
                  />
                  <span className="absolute -top-0.5 right-0 font-mono text-[10px] text-dim">
                    {a.support >= 0 ? "+" : ""}
                    {fmt(a.support * 100, 1)}pt
                  </span>
                </div>
                <div className="relative h-2.5 rounded-sm bg-bg">
                  <div className="absolute inset-y-0 left-0 bg-sky/70" style={{ width: `${(a.tvd / maxTvd) * 100}%` }} />
                </div>
                <div className="text-right font-mono text-[11px]">
                  {a.flipped ? <span className="text-rose">→ {trace.labels[a.top_without]}</span> : <span className="text-dim">same</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Stage>

      {trace.order_check && (
        <Stage
          n={7}
          title="Robustness: reverse the option order"
          caption="The same question is re-run with the options listed in reverse. A robust decision barely moves; a big change means the model is partly reacting to position, not meaning."
          right={trace.order_check.answer_changed ? <Pill tone="rose">answer changed</Pill> : <Pill tone="teal">stable</Pill>}
          delay={360}
        >
          {trace.probs.map((p, i) => (
            <Bar
              key={i}
              label={optionLabel(trace, i)}
              value={trace.order_check!.probs_reversed_order[i]}
              ghost={p}
              tone={trace.order_check!.answer_changed ? "rose" : "teal"}
              suffix={`${pct(trace.order_check!.probs_reversed_order[i])}`}
              mark={mark(i)}
            />
          ))}
          <div className="mt-2 text-[11px] text-dim">
            Grey outline: original order. Filled bar: reversed order. Distribution shift {fmt(trace.order_check.tvd, 3)}.
          </div>
        </Stage>
      )}
    </div>
  );
}

export function BrainView({ trace, truths, version }: { trace: Trace; truths?: Record<string, string>; version: number }) {
  const [selected, setActive] = useState(trace.order[0]);
  const active = trace.questions[selected] ? selected : trace.order[0];
  const q = trace.questions[active];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {trace.order.map((id) => {
          const t = trace.questions[id];
          const truth = truths?.[id];
          const correct = truth !== undefined && t.question.type !== "score" ? t.labels[argmax(t.probs)] === truth : undefined;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${
                id === active ? "border-amber/60 bg-amber/5" : "border-line hover:border-faint"
              }`}
            >
              <span className="font-mono text-[12px]">{id}</span>
              <span className={`font-mono text-[11px] ${correct === undefined ? "text-amber" : correct ? "text-teal" : "text-rose"}`}>
                {t.question.type === "noul"
                  ? pct(t.probs[1], 0)
                  : t.question.type === "score"
                    ? fmt(t.answer.score ?? 0, 2)
                    : t.answer.choice}
              </span>
            </button>
          );
        })}
        <span className="ml-auto font-mono text-[11px] text-dim">
          forward {trace.timing_ms.forward}ms · diagnostics {trace.timing_ms.diagnostics}ms ({trace.passes.diagnostic} passes)
        </span>
      </div>
      <QuestionBrain key={`${active}:${version}`} trace={q} truth={truths?.[active]} />
    </div>
  );
}
