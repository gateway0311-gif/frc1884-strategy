import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { signIn, testApp } from "../../test/helpers.js";
import { db } from "../db/client.js";
import { subscribe } from "./changeFeed.js";
import { saveManualMatch } from "./schedule.js";

let app: FastifyInstance;
let strategist: string;
const EVENT = "2026plan";
const MATCH = `${EVENT}_qm1`;

beforeAll(async () => {
  app = await testApp();
  db.prepare(`INSERT INTO events (event_key, name, season, game_id) VALUES (?, 'Plan test', 2026, 'rebuilt2026')`).run(EVENT);
  saveManualMatch(EVENT, { compLevel: "qm", matchNumber: 1, plannedAt: null, red: [601, 602, 603], blue: [604, 605, 606] });
  strategist = await signIn(app, "strategist", "Sol");
});

afterAll(async () => {
  await app.close();
});

const url = `/api/hub/events/${EVENT}/plans/${MATCH}`;

describe("match plans", () => {
  it("are for strategists and leads only", async () => {
    for (const role of ["scout", "manager"] as const) {
      const cookie = await signIn(app, role);
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload: { phases: { auto: {} } } })).statusCode).toBe(403);
    }
  });

  it("start empty, save both phases and announce the change to other strategists", async () => {
    expect((await app.inject({ method: "GET", url, headers: { cookie: strategist } })).json().plan).toBeNull();

    const seen: Array<{ entity: string; key: string; payload: unknown; audience: string[] }> = [];
    const stop = subscribe((change) => seen.push(change));
    const saved = await app.inject({
      method: "PUT",
      url,
      headers: { cookie: strategist },
      payload: {
        clientId: "tab-1",
        phases: {
          auto: { pos: { "601": { x: 100, y: 50 }, "not-a-team": { x: 1, y: 1 } }, strokes: [{ pts: [{ x: 1.234, y: 2 }, { x: 3, y: 4 }], color: "#facc15", width: 3.5 }, { pts: [{ x: 1, y: 1 }], color: "red" }], notes: "Take the left lane." },
          teleop: { pos: {}, strokes: [], notes: "" },
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ entity: "plan", key: MATCH, audience: ["strategy"], payload: { clientId: "tab-1", by: "Sol" } });

    const plan = (await app.inject({ method: "GET", url, headers: { cookie: strategist } })).json().plan;
    expect(plan.matchKey).toBe(MATCH);
    expect(plan.phases.auto.pos).toEqual({ "601": { x: 100, y: 50 } });
    expect(plan.phases.auto.strokes).toEqual([{ pts: [{ x: 1.2, y: 2 }, { x: 3, y: 4 }], color: "#facc15", width: 3.5 }]);
    expect(plan.phases.auto.notes).toBe("Take the left lane.");
  });

  it("keeps the latest version and refuses an unknown match or an empty save", async () => {
    await app.inject({ method: "PUT", url, headers: { cookie: strategist }, payload: { phases: { auto: { pos: {}, strokes: [], notes: "Changed." } } } });
    const plan = (await app.inject({ method: "GET", url, headers: { cookie: strategist } })).json().plan;
    expect(plan.phases.auto.notes).toBe("Changed.");
    expect(plan.phases.teleop.notes).toBe("");

    const missing = await app.inject({ method: "PUT", url: `/api/hub/events/${EVENT}/plans/nope`, headers: { cookie: strategist }, payload: { phases: { auto: {} } } });
    expect(missing.statusCode).toBe(404);
    const empty = await app.inject({ method: "PUT", url, headers: { cookie: strategist }, payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it("is the same plan the original strategy page reads", async () => {
    const legacy = (await app.inject({ method: "GET", url: `/api/events/${EVENT}/strategy-plans?scope=scheduled_match` })).json();
    expect(legacy.strategyPlans).toHaveLength(1);
    expect(legacy.strategyPlans[0].matchKey).toBe(MATCH);
  });
});
