// A GameDefinition holds everything that changes from one FRC season to the
// next. The server and the web app both read it, so swapping the game means
// writing one new definition file (plus a field drawing in the web app).

export const RATING_VALUES = ["exceptional", "good", "average", "bad", "no_evidence"] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

export const RATING_LABELS: Record<RatingValue, string> = {
  exceptional: "Exceptional",
  good: "Good",
  average: "Average",
  bad: "Bad",
  no_evidence: "No evidence",
};

// "no_evidence" is null so it is left out of averages rather than counted as zero.
export const RATING_SCORE: Record<RatingValue, number | null> = {
  exceptional: 4,
  good: 3,
  average: 2,
  bad: 1,
  no_evidence: null,
};

export interface SelectOption {
  value: string;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
}

export type FormField =
  | (FieldBase & { type: "counter"; steps?: number[]; max?: number })
  | (FieldBase & { type: "toggle" })
  | (FieldBase & { type: "select"; options: SelectOption[] })
  | (FieldBase & { type: "multi"; options: SelectOption[] })
  | (FieldBase & { type: "rating" })
  | (FieldBase & { type: "number"; min?: number; max?: number; unit?: string })
  | (FieldBase & { type: "text"; long?: boolean; maxLength?: number });

export interface FormSection {
  id: string;
  label: string;
  fields: FormField[];
}

export type EntryValue = number | boolean | string | string[] | null;
export type EntryData = Record<string, EntryValue>;

export interface MatchPhase {
  id: string;
  label: string;
  seconds: number;
}

export interface ScoringRow {
  label: string;
  detail?: string;
  points: number;
}

export interface ScoringGroup {
  id: string;
  label: string;
  note?: string;
  rows: ScoringRow[];
}

// The numbers an alliance needs to work out its score and ranking points.
export interface AllianceInput {
  key: string;
  label: string;
}

export interface BonusRp {
  id: string;
  label: string;
  description: string;
  input: string;
  threshold: number;
  rp: number;
}

export interface RpResult {
  score: number;
  outcome: "win" | "tie" | "loss";
  outcomeRp: number;
  bonuses: Array<{ id: string; label: string; earned: boolean; need: number; have: number; rp: number }>;
  total: number;
}

export interface TimelineRow {
  period: string;
  seconds: number;
  timer: string;
  red: boolean;
  blue: boolean;
}

export interface GameRule {
  id: string;
  title: string;
  description: string;
  penalty: string;
  category: string;
}

// How submitted entries roll up into one number per team.
export type MetricAgg =
  | { kind: "avg"; field: string }
  | { kind: "max"; field: string }
  | { kind: "rate"; field: string; equals?: EntryValue }
  | { kind: "ratingAvg"; field: string }
  | { kind: "selectRate"; field: string; values: string[] }
  | { kind: "avgPoints"; field: string; points: Record<string, number> };

export interface MetricDef {
  key: string;
  label: string;
  short: string;
  agg: MetricAgg;
  decimals?: number;
  percent?: boolean;
  higherIsBetter?: boolean;
}

export interface GameDefinition {
  id: string;
  season: number;
  name: string;
  matchSeconds: number;
  phases: MatchPhase[];
  scoring: ScoringGroup[];
  allianceInputs: AllianceInput[];
  outcomeRp: { win: number; tie: number; loss: number };
  bonusRp: BonusRp[];
  allianceScore(totals: Record<string, number>): number;
  timeline?: { title: string; note: string; rows: TimelineRow[] };
  rules: GameRule[];
  matchForm: FormSection[];
  pitForm: FormSection[];
  metrics: MetricDef[];
  // Rough points one robot scored, from one scout's entry. Used to compare
  // what scouts saw against the official alliance score.
  entryPoints?(data: EntryData): number;
  // Places where what a team said in the pits does not match what scouts saw.
  pitMismatches?(pit: EntryData, observed: Record<string, number>, matchesObserved: number): string[];
  // What an alliance is expected to put up, from its teams' compiled figures.
  // Returns the same keys as allianceInputs.
  predictInputs(teams: Array<Record<string, number>>): Record<string, number>;
  // The metric shown first and used for trends.
  headlineMetric: string;
  // Plain-language game summary handed to the AI brief writer.
  briefContext: string;
}

export function computeRp(
  game: GameDefinition,
  ours: Record<string, number>,
  theirs: Record<string, number>
): RpResult {
  const score = game.allianceScore(ours);
  const opponent = game.allianceScore(theirs);
  const outcome = score > opponent ? "win" : score === opponent ? "tie" : "loss";
  const outcomeRp = game.outcomeRp[outcome];
  const bonuses = game.bonusRp.map((b) => {
    const have = ours[b.input] ?? 0;
    return { id: b.id, label: b.label, earned: have >= b.threshold, need: b.threshold, have, rp: b.rp };
  });
  const total = outcomeRp + bonuses.reduce((sum, b) => sum + (b.earned ? b.rp : 0), 0);
  return { score, outcome, outcomeRp, bonuses, total };
}

export function allFields(sections: FormSection[]): FormField[] {
  return sections.flatMap((s) => s.fields);
}

// Checks an entry against a form. Unknown keys are dropped, wrong types are
// reported. With `complete`, required fields must be filled in too.
export function validateEntry(
  sections: FormSection[],
  input: unknown,
  options: { complete?: boolean } = {}
): { data: EntryData; errors: string[] } {
  const errors: string[] = [];
  const data: EntryData = {};
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  for (const field of allFields(sections)) {
    const raw = source[field.key];
    const empty = raw === undefined || raw === null || raw === "";
    if (empty) {
      if (options.complete && field.required) errors.push(`${field.label} is required`);
      continue;
    }
    switch (field.type) {
      case "counter":
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          errors.push(`${field.label} must be a number of 0 or more`);
          break;
        }
        const max = field.max ?? 9999;
        if (raw > max) {
          errors.push(`${field.label} cannot be more than ${max}`);
          break;
        }
        data[field.key] = field.type === "counter" ? Math.round(raw) : raw;
        break;
      }
      case "toggle":
        if (typeof raw !== "boolean") errors.push(`${field.label} must be yes or no`);
        else data[field.key] = raw;
        break;
      case "select":
        if (typeof raw !== "string" || !field.options.some((o) => o.value === raw)) {
          errors.push(`${field.label} has an unknown option`);
        } else data[field.key] = raw;
        break;
      case "multi":
        if (!Array.isArray(raw) || raw.some((v) => !field.options.some((o) => o.value === v))) {
          errors.push(`${field.label} has an unknown option`);
        } else data[field.key] = [...new Set(raw as string[])];
        break;
      case "rating":
        if (typeof raw !== "string" || !(RATING_VALUES as readonly string[]).includes(raw)) {
          errors.push(`${field.label} has an unknown rating`);
        } else data[field.key] = raw;
        break;
      case "text": {
        if (typeof raw !== "string") {
          errors.push(`${field.label} must be text`);
          break;
        }
        const limit = field.maxLength ?? (field.long ? 2000 : 200);
        data[field.key] = raw.slice(0, limit);
        break;
      }
    }
  }
  return { data, errors };
}
