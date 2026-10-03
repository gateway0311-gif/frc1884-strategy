import { computeRp, type GameDefinition, type RpResult } from "../shared/games/index.js";
import { matchClock, teamsIn, type ScheduleMatch } from "../shared/schedule.js";
import type { CompiledTeam, EventData } from "./compile.js";

// Readable answers built on the compiled figures: how a match is likely to go,
// and what has happened at the event so far.

export interface AllianceTeam {
  teamNumber: number;
  name: string;
  // Where the expected points came from.
  basis: "scouting" | "epa" | "opr" | "none";
  points: number | null;
  matchesObserved: number;
  flags: number;
}

export interface AllianceOutlook {
  teams: AllianceTeam[];
  // Expected totals for the ranking point calculation, from scouting only.
  inputs: Record<string, number>;
  // True when every team has scouting behind it.
  complete: boolean;
  expectedScore: number | null;
  rp: RpResult | null;
}

export interface MatchOutlook {
  matchKey: string;
  label: string;
  red: AllianceOutlook;
  blue: AllianceOutlook;
  favourite: "red" | "blue" | "even" | null;
  notes: string[];
}

function teamValues(team: CompiledTeam): Record<string, number> {
  return Object.fromEntries(Object.entries(team.metrics).flatMap(([key, metric]) => (metric.value === null ? [] : [[key, metric.value]])));
}

function expectedPoints(team: CompiledTeam | undefined): { basis: AllianceTeam["basis"]; points: number | null } {
  if (!team) return { basis: "none", points: null };
  if (team.matchesObserved > 0 && team.estPoints !== null) return { basis: "scouting", points: team.estPoints };
  // Public figures are per-alliance contributions, a fair stand-in until we have watched the robot.
  if (team.stats.epa !== null) return { basis: "epa", points: team.stats.epa };
  if (team.stats.opr !== null) return { basis: "opr", points: team.stats.opr };
  return { basis: "none", points: null };
}

function outlookFor(game: GameDefinition, match: ScheduleMatch, side: "red" | "blue", byTeam: Map<number, CompiledTeam>): Omit<AllianceOutlook, "rp"> {
  const teams = match[side].map((slot) => {
    const compiled = byTeam.get(slot.teamNumber);
    const { basis, points } = expectedPoints(compiled);
    return {
      teamNumber: slot.teamNumber,
      name: compiled?.name ?? slot.name ?? `Team ${slot.teamNumber}`,
      basis,
      points,
      matchesObserved: compiled?.matchesObserved ?? 0,
      flags: compiled?.flags.length ?? 0,
    };
  });
  const scouted = match[side].map((slot) => byTeam.get(slot.teamNumber)).filter((t): t is CompiledTeam => !!t && t.matchesObserved > 0);
  const known = teams.filter((t) => t.points !== null);
  return {
    teams,
    inputs: game.predictInputs(scouted.map(teamValues)),
    complete: scouted.length === match[side].length && match[side].length > 0,
    expectedScore: known.length === teams.length && teams.length > 0 ? known.reduce((sum, t) => sum + t.points!, 0) : null,
  };
}

export function matchOutlook(data: EventData, matchKey: string, ourTeam: number): MatchOutlook | null {
  const match = data.schedule.find((m) => m.matchKey === matchKey);
  if (!match) return null;
  const byTeam = new Map(data.compiled.teams.map((t) => [t.teamNumber, t]));
  const red = outlookFor(data.game, match, "red", byTeam);
  const blue = outlookFor(data.game, match, "blue", byTeam);
  const both = red.complete && blue.complete;
  const notes: string[] = [];

  let favourite: MatchOutlook["favourite"] = null;
  if (red.expectedScore !== null && blue.expectedScore !== null) {
    const gap = red.expectedScore - blue.expectedScore;
    const close = Math.max(8, 0.08 * Math.max(red.expectedScore, blue.expectedScore));
    favourite = Math.abs(gap) <= close ? "even" : gap > 0 ? "red" : "blue";
  }

  for (const [side, outlook] of [["Red", red], ["Blue", blue]] as const) {
    const unseen = outlook.teams.filter((t) => t.basis !== "scouting");
    if (unseen.length) {
      notes.push(`${side}: no scouting yet for ${unseen.map((t) => t.teamNumber).join(", ")}. ${unseen.some((t) => t.points !== null) ? "Public figures are used instead." : "Nothing is known about them."}`);
    }
  }

  const ourSide = match.red.some((t) => t.teamNumber === ourTeam) ? "red" : match.blue.some((t) => t.teamNumber === ourTeam) ? "blue" : null;
  if (ourSide) {
    const opponents = (ourSide === "red" ? blue : red).teams.filter((t) => t.points !== null).sort((a, b) => b.points! - a.points!);
    if (opponents[0]) notes.push(`Their biggest scorer is ${opponents[0].teamNumber} ${opponents[0].name}, at about ${Math.round(opponents[0].points!)} points a match.`);
    const defender = (ourSide === "red" ? match.blue : match.red)
      .map((slot) => byTeam.get(slot.teamNumber))
      .filter((t): t is CompiledTeam => !!t && (t.metrics.defence_rating?.value ?? 0) >= 3)
      .sort((a, b) => (b.metrics.defence_rating.value ?? 0) - (a.metrics.defence_rating.value ?? 0))[0];
    if (defender) notes.push(`${defender.teamNumber} ${defender.name} has been rated a strong defender.`);
  }

  return {
    matchKey,
    label: match.label,
    red: { ...red, rp: both ? computeRp(data.game, red.inputs, blue.inputs) : null },
    blue: { ...blue, rp: both ? computeRp(data.game, blue.inputs, red.inputs) : null },
    favourite,
    notes,
  };
}

export interface Dashboard {
  ourTeam: number;
  us: { rank: number | null; wins: number | null; losses: number | null; ties: number | null; rankingScore: number | null; teamCount: number };
  nextMatches: Array<{ matchKey: string; label: string; startsAt: number | null; alliance: "red" | "blue"; partners: number[]; opponents: number[]; favourite: MatchOutlook["favourite"] }>;
  topTeams: Array<{ teamNumber: number; name: string; points: number; matchesObserved: number }>;
  movers: Array<{ teamNumber: number; name: string; change: number; direction: "up" | "down" }>;
  watchList: Array<{ teamNumber: number; name: string; flags: string[] }>;
  coverage: EventData["compiled"]["coverage"] & { matchesPlayed: number };
}

export function dashboard(data: EventData, ourTeam: number, now: number): Dashboard {
  const { compiled, schedule, game } = data;
  const clock = matchClock(schedule, now, game.matchSeconds);
  const us = compiled.teams.find((t) => t.teamNumber === ourTeam);

  const nextMatches = clock.upcoming
    .filter((m) => teamsIn(m).some((t) => t.teamNumber === ourTeam))
    .slice(0, 4)
    .map((match) => {
      const alliance = match.red.some((t) => t.teamNumber === ourTeam) ? ("red" as const) : ("blue" as const);
      const other = alliance === "red" ? "blue" : "red";
      return {
        matchKey: match.matchKey,
        label: match.label,
        startsAt: clock.startsAt[match.matchKey] ?? null,
        alliance,
        partners: match[alliance].map((t) => t.teamNumber).filter((n) => n !== ourTeam),
        opponents: match[other].map((t) => t.teamNumber),
        favourite: matchOutlook(data, match.matchKey, ourTeam)?.favourite ?? null,
      };
    });

  const observed = compiled.teams.filter((t) => t.matchesObserved > 0 && t.estPoints !== null);
  const topTeams = [...observed]
    .sort((a, b) => b.estPoints! - a.estPoints!)
    .slice(0, 8)
    .map((t) => ({ teamNumber: t.teamNumber, name: t.name, points: t.estPoints!, matchesObserved: t.matchesObserved }));

  const movers = compiled.teams
    .flatMap((t) => {
      const trend = t.metrics[game.headlineMetric]?.trend;
      return trend === null || trend === undefined || Math.abs(trend) < 1 ? [] : [{ teamNumber: t.teamNumber, name: t.name, change: trend, direction: trend > 0 ? ("up" as const) : ("down" as const) }];
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 6);

  const watchList = compiled.teams
    .filter((t) => t.flags.some((f) => f.kind !== "few"))
    .slice(0, 8)
    .map((t) => ({ teamNumber: t.teamNumber, name: t.name, flags: t.flags.filter((f) => f.kind !== "few").map((f) => f.text) }));

  return {
    ourTeam,
    us: {
      rank: us?.stats.rank ?? null,
      wins: us?.stats.wins ?? null,
      losses: us?.stats.losses ?? null,
      ties: us?.stats.ties ?? null,
      rankingScore: us?.stats.rankingScore ?? null,
      teamCount: compiled.teams.length,
    },
    nextMatches,
    topTeams,
    movers,
    watchList,
    coverage: { ...compiled.coverage, matchesPlayed: schedule.filter((m) => clock.done[m.matchKey]).length },
  };
}

export interface TeamHistoryRow {
  matchKey: string;
  label: string;
  alliance: "red" | "blue";
  partners: number[];
  opponents: number[];
  allianceScore: number | null;
  opponentScore: number | null;
  played: boolean;
  entries: Array<{ id: string; scout: string; data: Record<string, unknown>; points: number | null }>;
}

export function teamDetail(data: EventData, teamNumber: number, now: number) {
  const team = data.compiled.teams.find((t) => t.teamNumber === teamNumber);
  if (!team) return null;
  const clock = matchClock(data.schedule, now, data.game.matchSeconds);
  const history: TeamHistoryRow[] = data.schedule
    .filter((m) => teamsIn(m).some((t) => t.teamNumber === teamNumber))
    .map((match) => {
      const alliance = match.red.some((t) => t.teamNumber === teamNumber) ? ("red" as const) : ("blue" as const);
      const other = alliance === "red" ? "blue" : "red";
      const score = (side: "red" | "blue") => (side === "red" ? match.redScore : match.blueScore);
      return {
        matchKey: match.matchKey,
        label: match.label,
        alliance,
        partners: match[alliance].map((t) => t.teamNumber).filter((n) => n !== teamNumber),
        opponents: match[other].map((t) => t.teamNumber),
        allianceScore: score(alliance),
        opponentScore: score(other),
        played: clock.done[match.matchKey],
        entries: data.entries
          .filter((e) => e.matchKey === match.matchKey && e.teamNumber === teamNumber)
          .map((e) => ({ id: e.id, scout: e.scout, data: e.data, points: data.game.entryPoints ? data.game.entryPoints(e.data) : null })),
      };
    });
  const notes = history.flatMap((row) =>
    row.entries.flatMap((e) => (typeof e.data.notes === "string" && e.data.notes.trim() ? [{ label: row.label, scout: e.scout, text: e.data.notes.trim() }] : []))
  );
  const pitEntries = data.pit
    .filter((p) => p.teamNumber === teamNumber && p.status === "submitted")
    .map((p) => ({ id: p.id, scout: p.scout, data: p.data, submittedAt: p.submittedAt }));
  return { team, history, notes, pitEntries };
}
