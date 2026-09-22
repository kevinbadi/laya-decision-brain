import type { Dataset, DatasetColumn, DatasetRow } from "@/lib/api";

const ALIASES: Record<string, string[]> = {
  lottery: ["lottery", "lotto", "payout", "50%", "90%"],
  smokes: ["smoke", "cigarette", "smoker"],
  drinks: ["drink", "alcohol", "drinking"],
  gambles: ["gambl"],
  skydived: ["skydive", "skydiv", "parachute"],
  speeds: ["speed limit", "speeding", "drive above"],
  cheated: ["cheat", "affair"],
  eats_steak: ["eat steak", "eats steak", "steak eater"],
  steak_doneness: ["doneness", "medium rare", "medium well", "how do you like your steak", "rare", "well done"],
  gender: ["gender", "male", "female", "men", "women"],
  age: ["age", "older", "young", "18-29", "60"],
  income: ["income", "rich", "poor", "salary", "high-income", "household"],
  education: ["education", "college", "degree", "graduate"],
  region: ["region", "location", "census", "midwest", "south", "pacific"],
};

export interface Crosstab {
  rowId: string;
  colId: string;
  rowLabel: string;
  colLabel: string;
  rows: string[];
  cols: string[];
  counts: number[][];
  /** P(col | row) */
  rowPct: number[][];
  colBase: number[];
  n: number;
}

export interface LiftHit {
  rowValue: string;
  colValue: string;
  n: number;
  pct: number;
  base: number;
  lift: number;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9+$%]+/g, " ").trim();
}

export function labelOf(col: DatasetColumn) {
  return col.id.replace(/_/g, " ");
}

export function matchColumns(ds: Dataset, text: string): DatasetColumn[] {
  const t = norm(text);
  const scored = ds.columns.map((c) => {
    let score = 0;
    if (t.includes(norm(c.id.replace(/_/g, " ")))) score += 4;
    for (const a of ALIASES[c.id] ?? []) {
      if (t.includes(norm(a))) score += a.length > 4 ? 4 : 2;
    }
    for (const word of norm(c.question).split(" ")) {
      if (word.length > 4 && t.includes(word)) score += 1;
    }
    for (const o of c.options) {
      const v = norm(o.value);
      if (v.length > 2 && t.includes(v)) score += 3;
    }
    return { c, score };
  });
  return scored
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.c);
}

export function crosstab(ds: Dataset, rowCol: DatasetColumn, colCol: DatasetColumn): Crosstab {
  const rows = rowCol.options.map((o) => o.value);
  const cols = colCol.options.map((o) => o.value);
  const counts = rows.map(() => cols.map(() => 0));
  let n = 0;
  for (const r of ds.rows) {
    const a = r.answers[rowCol.id];
    const b = r.answers[colCol.id];
    if (!a || !b) continue;
    const i = rows.indexOf(a);
    const j = cols.indexOf(b);
    if (i < 0 || j < 0) continue;
    counts[i][j] += 1;
    n += 1;
  }
  const colN = cols.map((_, j) => counts.reduce((s, row) => s + row[j], 0));
  const rowPct = counts.map((row) => {
    const tot = row.reduce((s, v) => s + v, 0);
    return row.map((v) => (tot ? v / tot : 0));
  });
  return {
    rowId: rowCol.id,
    colId: colCol.id,
    rowLabel: labelOf(rowCol),
    colLabel: labelOf(colCol),
    rows,
    cols,
    counts,
    rowPct,
    colBase: colN.map((v) => (n ? v / n : 0)),
    n,
  };
}

export function topLifts(tab: Crosstab, minN = 18): LiftHit[] {
  const hits: LiftHit[] = [];
  tab.rows.forEach((rv, i) => {
    const rowN = tab.counts[i].reduce((s, v) => s + v, 0);
    tab.cols.forEach((cv, j) => {
      const n = tab.counts[i][j];
      if (rowN < minN) return;
      hits.push({
        rowValue: rv,
        colValue: cv,
        n,
        pct: tab.rowPct[i][j],
        base: tab.colBase[j],
        lift: tab.rowPct[i][j] - tab.colBase[j],
      });
    });
  });
  return hits.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
}

export function formatLift(hit: LiftHit, rowLabel: string, colLabel: string) {
  const sign = hit.lift >= 0 ? "+" : "";
  return `${rowLabel}=${hit.rowValue} → ${colLabel}=${hit.colValue}: ${Math.round(hit.pct * 100)}% vs ${Math.round(hit.base * 100)}% overall (${sign}${Math.round(hit.lift * 100)}pt, n=${hit.n})`;
}

const INTERESTING: [string, string][] = [
  ["steak_doneness", "lottery"],
  ["eats_steak", "lottery"],
  ["smokes", "lottery"],
  ["gambles", "lottery"],
  ["skydived", "lottery"],
  ["speeds", "lottery"],
  ["cheated", "lottery"],
  ["gender", "steak_doneness"],
  ["age", "lottery"],
  ["eats_steak", "steak_doneness"],
];

export function notableAssociations(ds: Dataset, limit = 6): string[] {
  const lines: { line: string; mag: number }[] = [];
  for (const [a, b] of INTERESTING) {
    const ca = ds.columns.find((c) => c.id === a);
    const cb = ds.columns.find((c) => c.id === b);
    if (!ca || !cb) continue;
    const tab = crosstab(ds, ca, cb);
    const hit = topLifts(tab)[0];
    if (!hit || Math.abs(hit.lift) < 0.04) continue;
    lines.push({ line: formatLift(hit, tab.rowLabel, tab.colLabel), mag: Math.abs(hit.lift) });
  }
  return lines.sort((x, y) => y.mag - x.mag).slice(0, limit).map((x) => x.line);
}

export function univariate(ds: Dataset, id: string) {
  const col = ds.columns.find((c) => c.id === id);
  if (!col) return "";
  const n = col.options.reduce((s, o) => s + o.count, 0);
  return col.options
    .filter((o) => o.count)
    .map((o) => `${o.value} ${Math.round((o.count / n) * 100)}%`)
    .join(", ");
}

export function buildSurveyState(ds: Dataset, question: string) {
  const matched = matchColumns(ds, question);
  const pair =
    matched.length >= 2
      ? [matched[0], matched[1]]
      : matched.length === 1
        ? [matched[0], ds.columns.find((c) => c.id === (matched[0].id === "lottery" ? "steak_doneness" : "lottery"))].filter(Boolean)
        : [];
  const tab = pair.length === 2 ? crosstab(ds, pair[0]!, pair[1]!) : null;
  const lifts = tab ? topLifts(tab).slice(0, 4) : [];
  const state: Record<string, string> = {
    survey: `${ds.name}. ${ds.rows.length} respondents.`,
    user_question: question,
    lottery_split: univariate(ds, "lottery"),
    steak_doneness_split: univariate(ds, "steak_doneness"),
    eats_steak_split: univariate(ds, "eats_steak"),
    smokes_split: univariate(ds, "smokes"),
    gender_split: univariate(ds, "gender"),
  };
  if (tab && lifts.length) {
    state.focus_pair = `${tab.rowLabel} × ${tab.colLabel} (n=${tab.n})`;
    lifts.forEach((h, i) => {
      state[`finding_${i + 1}`] = formatLift(h, tab.rowLabel, tab.colLabel);
    });
  } else {
    notableAssociations(ds).forEach((line, i) => {
      state[`finding_${i + 1}`] = line;
    });
  }
  return { state, tab, matched };
}

export function layaVotesVsColumn(
  ds: Dataset,
  rowIds: string[],
  votes: number[],
  labels: string[],
  colId: string,
) {
  const col = ds.columns.find((c) => c.id === colId);
  if (!col) return null;
  const byVote: Record<string, Record<string, number>> = {};
  labels.forEach((l) => {
    byVote[l] = {};
    col.options.forEach((o) => {
      byVote[l][o.value] = 0;
    });
  });
  const counts: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
  rowIds.forEach((id, i) => {
    const row = ds.rows.find((r) => r.id === id);
    const v = row?.answers[colId];
    const vote = labels[votes[i]];
    if (!row || !v || !vote || byVote[vote][v] === undefined) return;
    byVote[vote][v] += 1;
    counts[vote] += 1;
  });
  return { col, byVote, counts };
}

export function sampleRows(rows: DatasetRow[], n: number) {
  if (rows.length <= n) return rows;
  const stride = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * stride)]);
}
