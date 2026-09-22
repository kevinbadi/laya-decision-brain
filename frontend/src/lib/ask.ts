import type { QuestionDef } from "@/lib/api";

/** Turn a typed line into a Laya question. "A or B" becomes a choice; anything else is yes/no. */
export function questionFromAsk(text: string, scope: "person" | "survey" = "person"): QuestionDef {
  const trimmed = text.trim().replace(/\?+$/, "");
  const or = trimmed.match(/^(.+?)\s+or\s+(.+)$/i);
  if (or) {
    const a = or[1].trim();
    const b = or[2].trim();
    if (a && b && a.length < 40 && b.length < 40) {
      return {
        type: "choice",
        instructions:
          scope === "survey"
            ? `Using only the survey counts in the state, which is more supported?`
            : `For this survey respondent, which fits better?`,
        criteria: { [a]: null, [b]: null },
      };
    }
  }
  return {
    type: "noul",
    instructions:
      scope === "survey"
        ? `These numbers are real survey counts. Answer using only them. If a difference is under 5 percentage points, treat it as no association. Question: ${trimmed}?`
        : `About this survey respondent: ${trimmed}?`,
    criteria: {},
  };
}

export const ASK_CHIPS = [
  "Is this person a risk taker?",
  "Would they try skydiving?",
  "Do they like steak cooked past medium?",
  "Lottery A or Lottery B",
  "Are they likely high-income?",
  "Does this person drink?",
];

export const SURVEY_CHIPS = [
  "Do people who like rare steak take the riskier lottery?",
  "Do smokers pick Lottery A more often?",
  "Is steak doneness related to gambling?",
  "Do men and women like their steak differently?",
  "Are younger people more likely to choose Lottery A?",
  "Do skydiving and speeding go together?",
];
