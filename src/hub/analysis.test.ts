import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { signIn, testApp } from "../../test/helpers.js";
import { db } from "../db/client.js";
import { saveEntry } from "./entries.js";
import { saveManualMatch } from "./schedule.js";
import { setSetting } from "./settings.js";

let app: FastifyInstance;
let strategist: string;
const EVENT = "2026ana";
const BASE = { auto_leave: "bump", scoring_rating: "good", defence_rating: "no_evidence" };

function entry(match: number, team: number, fuel: number, climb: string, extra: Record<string, unknown> = {}) {
  const result = saveEntry({ id: crypto.randomUUID(), eventKey: EVENT, matchKey: `${EVENT}_qm${match}`, teamNumber: team, scout: "Ana", data: { ...BASE, scoring_cycles: 4, teleop_fuel: fuel, climb_level: climb, ...extra }, status: "submitted" });
  if (!result.ok) throw new Error(result.error);
}

beforeAll(async () => {
  app = await testApp();
  setSetting("team_number", "401");
  db.prepare(`INSERT INTO events (event_key, name, season, game_id) VALUES (?, 'Analysis test', 2026, 'rebuilt2026')`).run(EVENT);
  const past = Date.now() - 60 * 60_000;
  saveManualMatch(EVENT, { compLevel: "qm", matchNumber: 1, plannedAt: new Date(past).toISOString(), red: [401, 402, 403], blue: [404, 405, 406] });
  db.prepare(`UPDATE matches SET red_score = 150, blue_score = 90, actual_at = planned_at WHERE match_key = ?`).run(`${EVENT}_qm1`);
  saveManualMatch(EVENT, { compLevel: "qm", matchNumber: 2, plannedAt: new Date(Date.now() + 10 * 60_000).toISOString(), red: [401, 404, 405], blue: [402, 403, 406] });
  saveManualMatch(EVENT, { compLevel: "qm", matchNumber: 3, plannedAt: new Date(Date.now() + 18 * 60_000).toISOString(), red: [402, 403, 407], blue: [404, 405, 406] });
  db.prepare(`INSERT INTO teams (team_number, name) VALUES (407, 'Unseen') ON CONFLICT DO NOTHING`).run();
  db.prepare(
    `INSERT INTO analytics_metrics (event_key, team_number, metric_name, metric_value, source_run) VALUES (?, 407, 'statbotics.event_epa.total_points_mean', 33, 'x')`
  ).run(EVENT);
  db.prepare(`INSERT INTO event_rankings (event_key, team_number, rank, ranking_score, wins, losses, ties, matches_played, updated_at) VALUES (?, 401, 3, 2.5, 1, 0, 0, 1, 'now')`).run(EVENT);

  entry(1, 401, 30, "l2");
  entry(1, 402, 50, "l3", { defence_rating: "exceptional" });
  entry(1, 403, 20, "none");
  entry(1, 404, 40, "l1");
  entry(1, 405, 10, "none");
  entry(1, 406, 25, "l2", { notes: "Fast intake, weak over the bump." });
  strategist = await signIn(app, "strategist");
});

afterAll(async () => {
  await app.close();
});

const get = async (path: string, cookie = strategist) => app.inject({ method: "GET", url: `/api/hub/events/${EVENT}/analysis/${path}`, headers: { cookie } });

describe("strategy analysis", () => {
  it("is for strategists and leads only", async () => {
    for (const role of ["scout", "manager"] as const) {
      const cookie = await signIn(app, role);
      for (const path of ["dashboard", "teams", "teams/401", `matches/${EVENT}_qm2`]) {
        expect((await get(path, cookie)).statusCode).toBe(403);
      }
    }
    const lead = await signIn(app, "lead");
    expect((await get("dashboard", lead)).statusCode).toBe(200);
  });

  it("predicts a match from scouted figures, with ranking points", async () => {
    const { outlook, teams } = (await get(`matches/${EVENT}_qm2`)).json();
    // Red: 401 (30 + L2 20), 404 (40 + L1 10), 405 (10). Blue: 402 (50 + L3 30), 403 (20), 406 (25 + L2 20).
    expect(outlook.red.inputs).toEqual({ fuel: 80, climb: 30 });
    expect(outlook.blue.inputs).toEqual({ fuel: 95, climb: 50 });
    expect(outlook.red.expectedScore).toBe(110);
    expect(outlook.blue.expectedScore).toBe(145);
    expect(outlook.favourite).toBe("blue");
    expect(outlook.blue.rp.total).toBe(4);
    expect(outlook.red.rp.total).toBe(0);
    expect(outlook.red.teams.every((t: { basis: string }) => t.basis === "scouting")).toBe(true);
    expect(outlook.notes.some((n: string) => n.includes("402"))).toBe(true);
    expect(outlook.notes.some((n: string) => n.includes("strong defender"))).toBe(true);
    expect(teams).toHaveLength(6);
  });

  it("falls back to public figures for a team nobody has watched, and says so", async () => {
    const { outlook } = (await get(`matches/${EVENT}_qm3`)).json();
    const unseen = outlook.red.teams.find((t: { teamNumber: number }) => t.teamNumber === 407);
    expect(unseen).toMatchObject({ basis: "epa", points: 33 });
    expect(outlook.red.complete).toBe(false);
    expect(outlook.red.rp).toBeNull();
    expect(outlook.red.expectedScore).toBe(80 + 20 + 33);
    expect(outlook.notes[0]).toContain("407");
  });

  it("summarises the event: our standing, next matches and the strongest teams", async () => {
    const data = (await get("dashboard")).json();
    expect(data.us).toMatchObject({ rank: 3, wins: 1, losses: 0 });
    expect(data.nextMatches).toHaveLength(1);
    expect(data.nextMatches[0]).toMatchObject({ label: "Qual 2", alliance: "red", partners: [404, 405], opponents: [402, 403, 406], favourite: "blue" });
    expect(data.topTeams[0]).toMatchObject({ teamNumber: 402, points: 80 });
    expect(data.coverage).toMatchObject({ entries: 6, teamsObserved: 6, matchesPlayed: 1 });
  });

  it("gives a team's match history, notes and upcoming matches", async () => {
    const detail = (await get("teams/406")).json();
    expect(detail.team.estPoints).toBe(45);
    expect(detail.history.map((h: { label: string }) => h.label)).toEqual(["Qual 1", "Qual 2", "Qual 3"]);
    expect(detail.history[0]).toMatchObject({ alliance: "blue", allianceScore: 90, opponentScore: 150, played: true });
    expect(detail.history[0].entries[0]).toMatchObject({ scout: "Ana", points: 45 });
    expect(detail.history[1].played).toBe(false);
    expect(detail.notes).toEqual([{ label: "Qual 1", scout: "Ana", text: "Fast intake, weak over the bump." }]);
    expect((await get("teams/99999")).statusCode).toBe(404);
  });
});
