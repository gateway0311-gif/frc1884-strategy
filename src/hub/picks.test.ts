import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { signIn, testApp } from "../../test/helpers.js";
import { db } from "../db/client.js";
import { saveManualMatch } from "./schedule.js";

let app: FastifyInstance;
let sol: string;
let lee: string;
const EVENT = "2026pick";
const url = `/api/hub/events/${EVENT}/picks`;

beforeAll(async () => {
  app = await testApp();
  db.prepare(`INSERT INTO events (event_key, name, season, game_id) VALUES (?, 'Pick test', 2026, 'rebuilt2026')`).run(EVENT);
  saveManualMatch(EVENT, { compLevel: "qm", matchNumber: 1, plannedAt: null, red: [701, 702, 703], blue: [704, 705, 706] });
  sol = await signIn(app, "strategist", "Sol");
  lee = await signIn(app, "lead", "Lee");
});

afterAll(async () => {
  await app.close();
});

const put = (cookie: string, payload: object) => app.inject({ method: "PUT", url, headers: { cookie }, payload });

describe("pick list", () => {
  it("is hidden from scouts and scout managers", async () => {
    for (const role of ["scout", "manager"] as const) {
      const cookie = await signIn(app, role);
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(403);
      expect((await put(cookie, { revision: 0, entries: [] })).statusCode).toBe(403);
    }
  });

  it("saves an ordered, tiered list shared by strategists and leads", async () => {
    const empty = (await app.inject({ method: "GET", url, headers: { cookie: sol } })).json();
    expect(empty).toEqual({ revision: 0, entries: [] });

    const saved = await put(sol, {
      revision: 0,
      entries: [
        { teamNumber: 705, tier: "second" },
        { teamNumber: 702, tier: "first", note: "Great climber" },
        { teamNumber: 704, tier: "first" },
        { teamNumber: 706, tier: "avoid" },
      ],
    });
    expect(saved.statusCode).toBe(200);
    const list = (await app.inject({ method: "GET", url, headers: { cookie: lee } })).json();
    expect(list.revision).toBe(1);
    expect(list.entries.map((e: { teamNumber: number; tier: string }) => `${e.teamNumber}:${e.tier}`)).toEqual(["702:first", "704:first", "705:second", "706:avoid"]);
    expect(list.entries[0]).toMatchObject({ note: "Great climber", picked: false, updatedBy: "Sol" });
  });

  it("refuses a reorder made from an out-of-date list and returns the current one", async () => {
    const stale = await put(lee, { revision: 0, entries: [{ teamNumber: 704, tier: "first" }] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().revision).toBe(1);
    expect(stale.json().entries).toHaveLength(4);
  });

  it("rejects teams not at the event, duplicates and unknown tiers", async () => {
    expect((await put(sol, { revision: 1, entries: [{ teamNumber: 9999, tier: "first" }] })).statusCode).toBe(400);
    expect((await put(sol, { revision: 1, entries: [{ teamNumber: 702, tier: "first" }, { teamNumber: 702, tier: "second" }] })).statusCode).toBe(400);
    expect((await put(sol, { revision: 1, entries: [{ teamNumber: 702, tier: "maybe" }] })).statusCode).toBe(400);
  });

  it("marks a team as taken and keeps that through a reorder", async () => {
    const marked = await app.inject({ method: "PUT", url: `${url}/702`, headers: { cookie: lee }, payload: { picked: true } });
    expect(marked.json().entries.find((e: { teamNumber: number }) => e.teamNumber === 702).picked).toBe(true);
    // Marking as taken does not change the revision, so a reorder in progress still goes through.
    const reordered = await put(sol, { revision: 1, entries: [{ teamNumber: 704, tier: "first" }, { teamNumber: 702, tier: "first" }, { teamNumber: 705, tier: "third" }] });
    expect(reordered.statusCode).toBe(200);
    const entries = reordered.json().entries;
    expect(entries.map((e: { teamNumber: number }) => e.teamNumber)).toEqual([704, 702, 705]);
    expect(entries[1]).toMatchObject({ picked: true, note: "Great climber" });
    const missing = await app.inject({ method: "PUT", url: `${url}/706`, headers: { cookie: lee }, payload: { picked: true } });
    expect(missing.statusCode).toBe(404);
  });
});
