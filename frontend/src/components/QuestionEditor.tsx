"use client";

import type { QuestionDef, QuestionType, Questions } from "@/lib/api";
import { Segmented } from "./ui";

function criteriaAsRows(q: QuestionDef): { key: string; desc: string }[] {
  if (q.type === "score") return ((q.criteria as string[]) ?? []).map((c) => ({ key: "", desc: c }));
  if (q.type === "choice")
    return Object.entries((q.criteria as Record<string, string | null>) ?? {}).map(([k, v]) => ({ key: k, desc: v ?? "" }));
  const c = (q.criteria as Record<string, string | null>) ?? {};
  return [
    { key: "true", desc: c.true ?? "" },
    { key: "false", desc: c.false ?? "" },
  ];
}

function rowsToCriteria(type: QuestionType, rows: { key: string; desc: string }[]): QuestionDef["criteria"] {
  if (type === "score") return rows.map((r) => r.desc);
  if (type === "choice") return Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.desc || null]));
  const out: Record<string, string> = {};
  for (const r of rows) if (r.desc) out[r.key] = r.desc;
  return out;
}

function convert(q: QuestionDef, to: QuestionType): QuestionDef {
  if (q.type === to) return q;
  const rows = criteriaAsRows(q);
  if (to === "noul") return { type: to, instructions: q.instructions, criteria: {} };
  if (to === "score") {
    const levels = q.type === "choice" ? rows.map((r) => (r.desc ? `${r.key}: ${r.desc}` : r.key)) : ["no", "somewhat", "yes"];
    return { type: to, instructions: q.instructions, criteria: levels };
  }
  const keys = q.type === "score" ? rows.map((r, i) => ({ key: r.desc.split(":")[0].trim() || `option_${i}`, desc: "" })) : [
    { key: "yes", desc: "" },
    { key: "no", desc: "" },
  ];
  return { type: to, instructions: q.instructions, criteria: rowsToCriteria("choice", keys) };
}

function QuestionCard({
  id,
  q,
  onChange,
  onRename,
  onRemove,
  locked,
}: {
  id: string;
  q: QuestionDef;
  onChange: (q: QuestionDef) => void;
  onRename: (id: string) => void;
  onRemove: () => void;
  locked?: boolean;
}) {
  const rows = criteriaAsRows(q);
  const setRows = (next: { key: string; desc: string }[]) => onChange({ ...q, criteria: rowsToCriteria(q.type, next) });

  return (
    <div className="rounded-lg border border-line bg-raised/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="field !w-auto flex-1 !py-1 font-mono !text-[12px]"
          value={id}
          disabled={locked}
          onChange={(e) => onRename(e.target.value.replace(/\s+/g, "_"))}
          aria-label="Question id"
        />
        <Segmented<QuestionType>
          value={q.type}
          onChange={(t) => onChange(convert(q, t))}
          options={[
            { value: "choice", label: "choice" },
            { value: "score", label: "score" },
            { value: "noul", label: "yes/no" },
          ]}
        />
        {!locked && (
          <button type="button" onClick={onRemove} className="px-1 text-dim hover:text-rose" aria-label="Remove question">
            ✕
          </button>
        )}
      </div>
      <textarea
        className="field min-h-[52px] resize-y !text-[12.5px] leading-snug"
        value={q.instructions}
        onChange={(e) => onChange({ ...q, instructions: e.target.value })}
        placeholder="Instructions the model reads for this question"
      />
      <div className="mt-2 space-y-1">
        <div className="label">
          {q.type === "choice" ? "options · optional description" : q.type === "score" ? "levels, low → high" : "optional true / false descriptions"}
        </div>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {q.type === "choice" && (
              <input
                className="field !w-[38%] !py-1 font-mono !text-[12px]"
                value={r.key}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              />
            )}
            {q.type === "score" && <span className="w-5 text-right font-mono text-[11px] text-dim">{i}</span>}
            {q.type === "noul" && <span className="w-10 font-mono text-[11px] text-dim">{r.key}</span>}
            <input
              className="field !py-1 !text-[12px]"
              value={r.desc}
              placeholder={q.type === "noul" ? "(default wording)" : q.type === "choice" ? "description" : "level text"}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
            />
            {q.type !== "noul" && (
              <button
                type="button"
                className="px-1 text-dim hover:text-rose"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                aria-label="Remove option"
              >
                −
              </button>
            )}
          </div>
        ))}
        {q.type !== "noul" && (
          <button
            type="button"
            className="mt-1 font-mono text-[11px] text-amber/80 hover:text-amber"
            onClick={() => setRows([...rows, { key: q.type === "choice" ? `option_${rows.length + 1}` : "", desc: "" }])}
          >
            + add {q.type === "choice" ? "option" : "level"}
          </button>
        )}
      </div>
    </div>
  );
}

export function QuestionEditor({
  questions,
  onChange,
  lockedIds = [],
}: {
  questions: Questions;
  onChange: (q: Questions) => void;
  lockedIds?: string[];
}) {
  const entries = Object.entries(questions);

  const rename = (from: string, to: string) => {
    if (!to || (to !== from && to in questions)) return;
    onChange(Object.fromEntries(entries.map(([k, v]) => (k === from ? [to, v] : [k, v]))));
  };

  const add = () => {
    let n = entries.length + 1;
    while (`question_${n}` in questions) n++;
    onChange({ ...questions, [`question_${n}`]: { type: "noul", instructions: "", criteria: {} } });
  };

  return (
    <div className="space-y-2.5">
      {entries.map(([id, q], i) => (
        <QuestionCard
          key={i}
          id={id}
          q={q}
          locked={lockedIds.includes(id)}
          onChange={(nq) => onChange({ ...questions, [id]: nq })}
          onRename={(to) => rename(id, to)}
          onRemove={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== id)))}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-lg border border-dashed border-line py-2 text-[12.5px] text-dim transition hover:border-amber/50 hover:text-amber"
      >
        + Add question
      </button>
    </div>
  );
}
