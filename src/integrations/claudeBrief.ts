import { createHash } from "node:crypto";

import { db } from "../db/client.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

export class ClaudeCredentialsMissingError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY environment variable is not set");
    this.name = "ClaudeCredentialsMissingError";
  }
}

export class MatchBriefMatchNotFoundError extends Error {
  constructor(matchKey: string) {
    super(`Match not found: ${matchKey}`);
    this.name = "MatchBriefMatchNotFoundError";
  }
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new ClaudeCredentialsMissingError();
  }
  return key;
}

export interface ClaudeRequest {
  model: string;
  system: string;
  // Sent first and cached, so repeated briefs for the same event cost less.
  context: string;
  prompt: string;
  maxTokens: number;
}

export interface ClaudeReply {
  text: string;
  model: string;
  cacheCreate: number;
  cacheRead: number;
}

// One call to the Anthropic API. Shared by the original match briefs and the hub.
export async function requestClaude(request: ClaudeRequest): Promise<ClaudeReply> {
  const apiKey = getApiKey();
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: request.context, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.prompt }
          ]
        }
      ]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    model?: string;
  };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n\n");
  return {
    text,
    model: data.model ?? request.model,
    cacheCreate: data.usage?.cache_creation_input_tokens ?? 0,
    cacheRead: data.usage?.cache_read_input_tokens ?? 0
  };
}

const SYSTEM_PROMPT = `You are a tactical match analyst for FRC Team 1884 Griffins at Newton Division, FIRST Championship 2026 (Houston). The robot is a HYBRID DEFENDER + FERRY: long rectangle, fast and agile, premium pin/box-out drivers within G418's 5-second limit. The robot CANNOT shoot, store fuel, or climb.

ROLE FLIPS BY HUB STATE:
- When OUR HUB is ACTIVE: 1884 ferries fuel from the neutral zone back under our truss to feed partners' shooters. Stay on our side of the field.
- When OUR HUB is INACTIVE: 1884 disrupts opponents — either blocks their truss path (if they can't go over the bump/ramp) OR denies their corner fuel pile. Engage on their side of the field aggressively.
- LAST 30 SECONDS (END GAME): NEVER on opponent side. Both HUBs become active again. 1884 must ferry only and stay on our side. Critical reason: any contact with an opponent climbing on TOWER triggers G420 — they get free Level 3 points (30+ pts), which can flip a match outcome. We've been burned by this before.

So 1884's value is rhythmic: ferry-disrupt-ferry-disrupt-ferry-final-ferry, dictated by HUB state. Plus surgical pin work on their best scorer when on the disrupt phase.

You will receive game context, then a specific match with full data on all 6 teams. Output exactly two markdown sections:

## Strategist
Five bullets, in this exact order:
- **Threat:** [primary opposing scorer to neutralize during disrupt phases, with team #, EPA, key capability]
- **Partners:** [strengths of our 2 partners, what they offer offensively + climb potential for TRAVERSAL]
- **Phase plan:** [what 1884 does in each HUB state — ferry pattern when our HUB active, disrupt target when our HUB inactive, where to position last 30s]
- **RP opportunity:** [Win/ENERGIZED/SUPERCHARGED/TRAVERSAL realistic targets, with math. Note: 1884 doesn't climb so TRAVERSAL depends entirely on partners.]
- **Key risk:** [the one thing that loses the match]

## Driver
Five short imperatives, max 12 words each, action verbs first. No numbered list, just dashes. The fifth bullet must always relate to End Game positioning and reinforce: never on opponent side last 30s.

Example shape:
- [HUB-active behaviour with specific team/lane]
- [HUB-inactive disrupt target, specific tactic]
- [Pin timing or release rule]
- [Mid-match adjustment trigger]
- Endgame 0:30 — return to our side, ferry only, stay clear of climbers.

Be specific with team numbers. Be honest about likely outcomes. If the data is thin or contradictory, say so in Key risk.`;

const GAME_CONTEXT = `REBUILT 2026 game basics:
- Match: 2:40 total - AUTO 20s, Transition 10s, 4 Shifts x 25s, End Game 30s
- AUTO winner controls HUB activation order in Shift 1; HUBs alternate active/inactive after
- Scoring in INACTIVE HUB = 0 points
- FUEL in active HUB: 1pt. TOWER L1: 10-15, L2: 20, L3: 30
- Ranking Points: Win 3, Tie 1, ENERGIZED (100+ FUEL) 1, SUPERCHARGED (360+ FUEL) 1, TRAVERSAL (50+ climb pts) 1
- Key rules: G418 (5s pin limit, 3s back off), G420 (no TOWER contact last 30s), G403 (no center-line cross + opponent contact in AUTO)

G420 CRITICAL: From the moment End Game starts (last 30s), any contact with an opposing robot on the TOWER awards them Level 3 climb points (30+) regardless of where they actually finish. This is a match-deciding penalty. 1884 has lost matches to this exact foul before — never suggest defensive engagement in the last 30 seconds.

End Game state: both HUBs become active again. 1884's only job in End Game is ferrying fuel for our alliance's last shots. Stay entirely on our side of the field.

Tier system used in scout data:
- S = 200+ EPA (elite)
- A = 150-199 EPA (strong)
- B = 110-149 EPA (mid)
- U = <110 EPA (low or unknown)

Capability fields you may see per team: drivetrain, fuel_acquisition, fuel_passing, fuel_scoring_position, hopper_capacity, shooter_type, trench_bump (can it cross trench/bump), endgame_climb (None/L1/L2/L3), bps (balls per second), auto_climb. Plus free-text comments from scouts.

DATA SOURCE HIERARCHY — weight in this order (most reliable first):

1. HOUSTON LIVE MATCH OBSERVATIONS (source='scout-sheet'): What the robot actually does on the field at this event. THIS IS GROUND TRUTH. When this data exists for a team, it overrides everything else. If a team claims 30 BPS in pit scouting but live observations show them scoring 8 cycles total in 5 matches, trust the observations.

2. TBA OPR/DPR (metric_name='tba.opr', 'tba.dpr'): Statistical contribution computed from real match results at this event. Becomes meaningful after ~30 quals played. Pre-30 it's noisy.

3. PIT SCOUTING (source='pit-scouting'): Interview data captured at Houston — what TEAMS CLAIM about their own robot. UNRELIABLE in isolation. Teams routinely:
   - Over-promise capabilities ("we can climb L3 every match" when they actually do it 30% of the time)
   - Quote their best-case BPS rather than their match average
   - Describe an aspirational auto routine they've never reliably executed
   - Hide weaknesses or downplay struggles
   PIT SCOUTING IS USEFUL FOR: detecting recent CHANGES ("we removed the climber and added bigger hopper" — that's actionable signal that pre-scouting cannot capture), photo-verifying drivetrain/mechanism type, capturing self-reported struggles (the "struggling with" field is more honest than positive claims because teams rarely fabricate problems). Pit scouting is more current than pre-scouting because it's captured at this event.

4. PRE-SCOUTING (source='pre-scouting'): EPA and capabilities aggregated from teams' regional events earlier in 2026. Stale — robots evolve significantly between regionals and Champs (rebuilds, mechanism swaps, driver changes). Treat as "starting hypothesis," not fact. Override with anything more recent.

WHEN THE SOURCES DISAGREE: Default to live observations. If pit scouting claims a capability that no live observation confirms, treat the capability as UNVERIFIED and flag it in the Strategist "Key risk" bullet. Example: "Key risk: 9128 claims 25 BPS in pit scouting but live data shows ~8 BPS — if they actually hit their claimed rate, our defensive plan needs adjustment."

When ONLY pit scouting exists for a team (no live match yet), use it but caveat in the brief: "[per pit interview, unverified]". When ONLY pre-scouting exists, caveat: "[from regionals, may be outdated]".`;

interface MatchAllianceTeam {
  alliance: string;
  station: number;
  team_number: number;
  name: string;
  capabilities: unknown[];
  metrics: unknown[];
  matchObservations: unknown[];
  pitObservations: unknown[];
}

interface MatchBundle {
  eventKey: string;
  match: {
    match_key: string;
    match_number: number;
    comp_level: string;
    scheduled_at: string | null;
    red_score: number | null;
    blue_score: number | null;
  };
  teams: MatchAllianceTeam[];
}

function loadMatchBundle(eventKey: string, matchKey: string): MatchBundle | null {
  const matchRow = db
    .prepare(`
      SELECT id, match_key, match_number, comp_level, scheduled_at, red_score, blue_score
      FROM matches
      WHERE match_key = ? AND event_key = ?
    `)
    .get(matchKey, eventKey) as
    | {
        id: number;
        match_key: string;
        match_number: number;
        comp_level: string;
        scheduled_at: string | null;
        red_score: number | null;
        blue_score: number | null;
      }
    | undefined;

  if (!matchRow) {
    return null;
  }

  const allianceTeams = db
    .prepare(`
      SELECT a.alliance_color AS alliance, mat.station, t.team_number, t.name
      FROM match_alliances a
      JOIN match_alliance_teams mat ON mat.alliance_id = a.id
      JOIN teams t ON t.team_number = mat.team_number
      WHERE a.match_id = ?
      ORDER BY a.alliance_color ASC, mat.station ASC
    `)
    .all(matchRow.id) as Array<{
    alliance: string;
    station: number;
    team_number: number;
    name: string;
  }>;

  const capabilitiesQ = db.prepare(`
    SELECT capability_name, capability_value, source, observed_at
    FROM team_capabilities
    WHERE event_key = ? AND team_number = ?
    ORDER BY source ASC, capability_name ASC
  `);
  const metricsQ = db.prepare(`
    SELECT event_key, metric_name, metric_value, source_run, computed_at
    FROM analytics_metrics
    WHERE team_number = ? AND (event_key = ? OR event_key IS NULL)
    ORDER BY metric_name ASC, computed_at DESC
  `);
  const matchObsQ = db.prepare(`
    SELECT m.match_key, m.match_number, m.comp_level, mo.phase, mo.scouter,
           mo.fuel_scored, mo.climb_points, mo.notes, mo.source, mo.observed_at
    FROM match_observations mo
    JOIN matches m ON m.id = mo.match_id
    WHERE m.event_key = ? AND mo.team_number = ?
    ORDER BY m.match_number ASC, mo.observed_at ASC
  `);
  const pitObsQ = db.prepare(`
    SELECT scouter, stars, avg_fuel, climb_capability, warning_flag, notes, source, observed_at
    FROM pit_observations
    WHERE event_key = ? AND team_number = ?
    ORDER BY observed_at DESC
  `);

  const teams: MatchAllianceTeam[] = allianceTeams.map((a) => ({
    alliance: a.alliance,
    station: a.station,
    team_number: a.team_number,
    name: a.name,
    capabilities: capabilitiesQ.all(eventKey, a.team_number),
    metrics: metricsQ.all(a.team_number, eventKey),
    matchObservations: matchObsQ.all(eventKey, a.team_number),
    pitObservations: pitObsQ.all(eventKey, a.team_number)
  }));

  return {
    eventKey,
    match: {
      match_key: matchRow.match_key,
      match_number: matchRow.match_number,
      comp_level: matchRow.comp_level,
      scheduled_at: matchRow.scheduled_at,
      red_score: matchRow.red_score,
      blue_score: matchRow.blue_score
    },
    teams
  };
}

function hashBundle(bundle: MatchBundle): string {
  return createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
}

function splitSections(md: string): { strategist: string; driver: string } {
  const STRAT = "## Strategist";
  const DRIVER = "## Driver";
  const sIdx = md.indexOf(STRAT);
  const dIdx = md.indexOf(DRIVER);
  if (sIdx === -1 || dIdx === -1 || dIdx < sIdx) {
    return { strategist: md.trim(), driver: "" };
  }
  const strategist = md.slice(sIdx + STRAT.length, dIdx).trim();
  const driver = md.slice(dIdx + DRIVER.length).trim();
  return { strategist, driver };
}

export type BriefStaleness = "fresh" | "stale" | "missing";

export interface MatchBriefStatus {
  matchKey: string;
  eventKey: string;
  staleness: BriefStaleness;
  strategist: string | null;
  driver: string | null;
  generatedAt: string | null;
  model: string | null;
}

export function getMatchBriefStatus(eventKey: string, matchKey: string): MatchBriefStatus {
  const bundle = loadMatchBundle(eventKey, matchKey);
  if (!bundle) {
    throw new MatchBriefMatchNotFoundError(matchKey);
  }
  const currentHash = hashBundle(bundle);
  const row = db
    .prepare(`
      SELECT strategist_md, driver_md, data_hash, model, generated_at
      FROM match_briefs
      WHERE match_key = ?
    `)
    .get(matchKey) as
    | {
        strategist_md: string;
        driver_md: string;
        data_hash: string;
        model: string;
        generated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      matchKey,
      eventKey,
      staleness: "missing",
      strategist: null,
      driver: null,
      generatedAt: null,
      model: null
    };
  }

  return {
    matchKey,
    eventKey,
    staleness: row.data_hash === currentHash ? "fresh" : "stale",
    strategist: row.strategist_md,
    driver: row.driver_md,
    generatedAt: row.generated_at,
    model: row.model
  };
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: AnthropicUsage;
  model?: string;
}

export interface GenerateMatchBriefResult {
  matchKey: string;
  eventKey: string;
  strategist: string;
  driver: string;
  generatedAt: string;
  model: string;
  staleness: BriefStaleness;
  cacheStats: { creation: number; read: number };
}

interface BriefLogger {
  info: (data: object) => void;
}

export async function generateMatchBrief(
  eventKey: string,
  matchKey: string,
  log?: BriefLogger
): Promise<GenerateMatchBriefResult> {
  const apiKey = getApiKey();
  const bundle = loadMatchBundle(eventKey, matchKey);
  if (!bundle) {
    throw new MatchBriefMatchNotFoundError(matchKey);
  }

  const matchSpecificData = `Match data for ${bundle.match.match_key} (qual ${bundle.match.match_number}). Six teams below — alliances, capabilities, metrics, observations.\n\n\`\`\`json\n${JSON.stringify(bundle, null, 2)}\n\`\`\`\n\nProduce the Strategist + Driver brief now.`;

  const requestBody = {
    model: MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: GAME_CONTEXT,
            cache_control: { type: "ephemeral" }
          },
          {
            type: "text",
            text: matchSpecificData
          }
        ]
      }
    ]
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n");

  const { strategist, driver } = splitSections(text);
  const cacheCreate = data.usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = data.usage?.cache_read_input_tokens ?? 0;
  const generatedAt = new Date().toISOString();
  const dataHash = hashBundle(bundle);
  const usedModel = data.model ?? MODEL;

  if (log) {
    log.info({ event: "claude_brief_generated", matchKey, eventKey, cacheCreate, cacheRead, model: usedModel });
  }

  db.prepare(`
    INSERT INTO match_briefs (match_key, event_key, strategist_md, driver_md, data_hash, model, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_key) DO UPDATE SET
      event_key = excluded.event_key,
      strategist_md = excluded.strategist_md,
      driver_md = excluded.driver_md,
      data_hash = excluded.data_hash,
      model = excluded.model,
      generated_at = excluded.generated_at
  `).run(matchKey, eventKey, strategist, driver, dataHash, usedModel, generatedAt);

  return {
    matchKey,
    eventKey,
    strategist,
    driver,
    generatedAt,
    model: usedModel,
    staleness: "fresh",
    cacheStats: { creation: cacheCreate, read: cacheRead }
  };
}
