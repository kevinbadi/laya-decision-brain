import type { Dataset, DatasetColumn, DatasetRow } from "@/lib/api";

export const FIELD_LABEL: Record<string, string> = {
  lottery: "lottery (A: 50%·$100 vs B: 90%·$20)",
  smokes: "smokes cigarettes",
  drinks: "drinks alcohol",
  gambles: "gambles",
  skydived: "has been skydiving",
  speeds: "drives above the speed limit",
  cheated: "has cheated on a partner",
  eats_steak: "eats steak",
  steak_doneness: "steak doneness",
  gender: "gender",
  age: "age",
  income: "household income",
  education: "education",
  region: "census region",
};

export function shortLabel(col: DatasetColumn) {
  return FIELD_LABEL[col.id] ?? col.question;
}

export function rowState(ds: Dataset, row: DatasetRow, target: string, excluded: string[]): Record<string, string> {
  return Object.fromEntries(
    ds.columns
      .filter((c) => c.id !== target && !excluded.includes(c.id) && row.answers[c.id])
      .map((c) => [FIELD_LABEL[c.id] ?? shortLabel(c), row.answers[c.id]]),
  );
}

export function fullRowState(ds: Dataset, row: DatasetRow): Record<string, string> {
  return Object.fromEntries(
    ds.columns.filter((c) => row.answers[c.id]).map((c) => [FIELD_LABEL[c.id] ?? shortLabel(c), row.answers[c.id]]),
  );
}
