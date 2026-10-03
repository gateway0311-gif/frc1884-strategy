import { db } from "../db/client.js";
import type { StrategyPlanUpsertBody } from "../types/domain.js";

export function hydrateMatchesForEvent(eventKey: string) {
  const rows = db
    .prepare(`
      SELECT
        m.match_key,
        m.event_key,
        m.comp_level,
        m.match_number,
        m.scheduled_at,
        m.red_score,
        m.blue_score,
        m.source,
        a.alliance_color,
        a.score AS alliance_score,
        a.ranking_points,
        mat.station,
        t.team_number,
        t.name AS team_name
      FROM matches m
      LEFT JOIN match_alliances a ON a.match_id = m.id
      LEFT JOIN match_alliance_teams mat ON mat.alliance_id = a.id
      LEFT JOIN teams t ON t.team_number = mat.team_number
      WHERE m.event_key = ? AND m.comp_level != 'pm'
      ORDER BY m.match_number ASC, a.alliance_color ASC, mat.station ASC
    `)
    .all(eventKey) as Array<{
    match_key: string;
    event_key: string;
    comp_level: string;
    match_number: number;
    scheduled_at: string | null;
    red_score: number | null;
    blue_score: number | null;
    source: string;
    alliance_color: "red" | "blue" | null;
    alliance_score: number | null;
    ranking_points: number | null;
    station: number | null;
    team_number: number | null;
    team_name: string | null;
  }>;

  const matches = new Map<
    string,
    {
      matchKey: string;
      eventKey: string;
      compLevel: string;
      matchNumber: number;
      scheduledAt: string | null;
      source: string;
      result: { redScore: number | null; blueScore: number | null };
      alliances: {
        red: { score: number | null; rankingPoints: number | null; teams: Array<{ station: number; teamNumber: number; name: string | null }> };
        blue: { score: number | null; rankingPoints: number | null; teams: Array<{ station: number; teamNumber: number; name: string | null }> };
      };
    }
  >();

  for (const row of rows) {
    if (!matches.has(row.match_key)) {
      matches.set(row.match_key, {
        matchKey: row.match_key,
        eventKey: row.event_key,
        compLevel: row.comp_level,
        matchNumber: row.match_number,
        scheduledAt: row.scheduled_at,
        source: row.source,
        result: {
          redScore: row.red_score,
          blueScore: row.blue_score
        },
        alliances: {
          red: { score: null, rankingPoints: null, teams: [] },
          blue: { score: null, rankingPoints: null, teams: [] }
        }
      });
    }

    const match = matches.get(row.match_key);

    if (!match || !row.alliance_color) {
      continue;
    }

    match.alliances[row.alliance_color].score = row.alliance_score;
    match.alliances[row.alliance_color].rankingPoints = row.ranking_points;

    if (row.team_number && row.station) {
      match.alliances[row.alliance_color].teams.push({
        station: row.station,
        teamNumber: row.team_number,
        name: row.team_name
      });
    }
  }

  return [...matches.values()];
}

export function loadStrategyPlanWithVersions(planId: number) {
  const plan = db
    .prepare(`
      SELECT
        sp.id,
        sp.event_key,
        sp.scope,
        sp.title,
        sp.notes,
        sp.created_at,
        sp.updated_at,
        m.match_key
      FROM strategy_plans sp
      LEFT JOIN matches m ON m.id = sp.match_id
      WHERE sp.id = ?
    `)
    .get(planId) as
    | {
        id: number;
        event_key: string;
        scope: string;
        title: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
        match_key: string | null;
      }
    | undefined;

  if (!plan) {
    return null;
  }

  const versions = db
    .prepare(`
      SELECT phase, data_json, created_by, created_at
      FROM strategy_plan_versions
      WHERE plan_id = ?
      ORDER BY id DESC
    `)
    .all(planId) as Array<{
    phase: "auto" | "teleop";
    data_json: string;
    created_by: string | null;
    created_at: string;
  }>;

  const phases: Record<string, unknown> = {};

  for (const version of versions) {
    if (!(version.phase in phases)) {
      phases[version.phase] = JSON.parse(version.data_json);
    }
  }

  return {
    id: plan.id,
    eventKey: plan.event_key,
    matchKey: plan.match_key,
    scope: plan.scope,
    title: plan.title,
    notes: plan.notes,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
    phases
  };
}

// Saves a strategy plan: one plan per match (or one free board per event),
// with each save kept as a new version per phase. Used by the original
// strategy page and by the hub.
export function upsertStrategyPlan(
  eventKey: string,
  scope: "scheduled_match" | "free_play",
  body: StrategyPlanUpsertBody
): { ok: true; planId: number } | { ok: false; error: "event_not_found" | "match_not_found" } {
  const existingEvent = db.prepare(`SELECT event_key FROM events WHERE event_key = ?`).get(eventKey);
  if (!existingEvent) {
    return { ok: false, error: "event_not_found" };
  }

  const matchId =
    scope === "scheduled_match"
      ? (
          db.prepare(`SELECT id FROM matches WHERE event_key = ? AND match_key = ?`).get(eventKey, body.matchKey) as
            | { id: number }
            | undefined
        )?.id ?? null
      : null;

  if (scope === "scheduled_match" && !matchId) {
    return { ok: false, error: "match_not_found" };
  }

  const transaction = db.transaction(() => {
    const existingPlan = db
      .prepare(`
        SELECT id
        FROM strategy_plans
        WHERE event_key = ?
          AND scope = ?
          AND (
            (? IS NULL AND match_id IS NULL) OR
            match_id = ?
          )
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(eventKey, scope, matchId, matchId) as { id: number } | undefined;

    let planId: number;

    if (existingPlan) {
      db.prepare(`
        UPDATE strategy_plans
        SET title = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(body.title ?? null, body.notes ?? null, existingPlan.id);
      planId = existingPlan.id;
    } else {
      const result = db.prepare(`
        INSERT INTO strategy_plans (event_key, match_id, scope, title, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(eventKey, matchId, scope, body.title ?? null, body.notes ?? null);
      planId = Number(result.lastInsertRowid);
    }

    for (const phase of ["auto", "teleop"] as const) {
      const phaseData = body.phases?.[phase];

      if (phaseData !== undefined) {
        db.prepare(`
          INSERT INTO strategy_plan_versions (plan_id, phase, data_json, created_by)
          VALUES (?, ?, ?, ?)
        `).run(planId, phase, JSON.stringify(phaseData), body.updatedBy ?? null);
      }
    }

    return planId;
  });

  return { ok: true, planId: transaction() };
}

export function findMatchPlanId(eventKey: string, matchKey: string): number | null {
  const row = db
    .prepare(`
      SELECT sp.id
      FROM strategy_plans sp
      JOIN matches m ON m.id = sp.match_id
      WHERE sp.event_key = ? AND sp.scope = 'scheduled_match' AND m.match_key = ?
      ORDER BY sp.updated_at DESC
      LIMIT 1
    `)
    .get(eventKey, matchKey) as { id: number } | undefined;
  return row?.id ?? null;
}
