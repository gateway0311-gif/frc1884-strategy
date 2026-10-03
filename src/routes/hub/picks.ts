import type { FastifyInstance } from "fastify";

import { db } from "../../db/client.js";
import { publish } from "../../hub/changeFeed.js";
import { requirePermission } from "../../hub/session.js";
import { getEvent, getSetting, setSetting } from "../../hub/settings.js";

const TIERS = ["first", "second", "third", "avoid"] as const;
type Tier = (typeof TIERS)[number];

interface Row {
  team_number: number;
  tier: Tier;
  position: number;
  note: string;
  picked: number;
  updated_by: string | null;
  updated_at: string;
}

function revision(eventKey: string): number {
  return Number(getSetting(`picks_rev:${eventKey}`) ?? 0);
}

function load(eventKey: string) {
  const rows = db
    .prepare(`SELECT team_number, tier, position, note, picked, updated_by, updated_at FROM pick_list_entries WHERE event_key = ? ORDER BY position ASC`)
    .all(eventKey) as Row[];
  return {
    revision: revision(eventKey),
    entries: rows.map((r) => ({ teamNumber: r.team_number, tier: r.tier, note: r.note, picked: r.picked === 1, updatedBy: r.updated_by, updatedAt: r.updated_at })),
  };
}

// The alliance selection pick list. One shared list per event, ordered within
// tiers, updated live for every strategist.
export async function hubPickRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission("strategy") };

  app.get<{ Params: { eventKey: string } }>("/events/:eventKey/picks", guard, async (request, reply) => {
    if (!getEvent(request.params.eventKey)) return reply.code(404).send({ error: "event_not_found" });
    return load(request.params.eventKey);
  });

  // Replace the order and tiers. The revision stops two people's reorders
  // from silently overwriting each other.
  app.put<{ Params: { eventKey: string } }>("/events/:eventKey/picks", guard, async (request, reply) => {
    const { eventKey } = request.params;
    if (!getEvent(eventKey)) return reply.code(404).send({ error: "event_not_found" });
    const body = (request.body ?? {}) as { revision?: unknown; entries?: unknown };
    if (!Array.isArray(body.entries)) return reply.code(400).send({ error: "invalid_list" });
    if (Number(body.revision) !== revision(eventKey)) return reply.code(409).send({ error: "list_changed", ...load(eventKey) });

    const atEvent = new Set((db.prepare(`SELECT team_number FROM event_teams WHERE event_key = ?`).all(eventKey) as Array<{ team_number: number }>).map((r) => r.team_number));
    const seen = new Set<number>();
    const entries: Array<{ teamNumber: number; tier: Tier; note: string | undefined }> = [];
    for (const item of body.entries as Array<{ teamNumber?: unknown; tier?: unknown; note?: unknown }>) {
      const teamNumber = Number(item?.teamNumber);
      if (!atEvent.has(teamNumber) || seen.has(teamNumber) || !TIERS.includes(item.tier as Tier)) {
        return reply.code(400).send({ error: "invalid_list" });
      }
      seen.add(teamNumber);
      entries.push({ teamNumber, tier: item.tier as Tier, note: typeof item.note === "string" ? item.note.slice(0, 300) : undefined });
    }

    const now = new Date().toISOString();
    const by = request.hubUser!.name;
    db.transaction(() => {
      const existing = new Map((db.prepare(`SELECT team_number, note, picked FROM pick_list_entries WHERE event_key = ?`).all(eventKey) as Array<{ team_number: number; note: string; picked: number }>).map((r) => [r.team_number, r]));
      db.prepare(`DELETE FROM pick_list_entries WHERE event_key = ?`).run(eventKey);
      const insert = db.prepare(
        `INSERT INTO pick_list_entries (event_key, team_number, tier, position, note, picked, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // Tiers are stored in order so one position column sorts the whole list.
      let position = 0;
      for (const tier of TIERS) {
        for (const entry of entries.filter((e) => e.tier === tier)) {
          const previous = existing.get(entry.teamNumber);
          insert.run(eventKey, entry.teamNumber, tier, position++, entry.note ?? previous?.note ?? "", previous?.picked ?? 0, by, now);
        }
      }
      setSetting(`picks_rev:${eventKey}`, String(revision(eventKey) + 1));
    })();
    publish({ eventKey, entity: "picks", key: eventKey, audience: ["strategy"] });
    return load(eventKey);
  });

  // Mark a team as taken during alliance selection, or change its note. Works
  // on any team at the event, listed or not, and never conflicts.
  app.put<{ Params: { eventKey: string; teamNumber: string } }>("/events/:eventKey/picks/:teamNumber", guard, async (request, reply) => {
    const { eventKey } = request.params;
    const teamNumber = Number(request.params.teamNumber);
    const body = (request.body ?? {}) as { picked?: unknown; note?: unknown };
    const row = db.prepare(`SELECT 1 FROM pick_list_entries WHERE event_key = ? AND team_number = ?`).get(eventKey, teamNumber);
    if (!row) return reply.code(404).send({ error: "team_not_on_list" });
    const now = new Date().toISOString();
    if (typeof body.picked === "boolean") {
      db.prepare(`UPDATE pick_list_entries SET picked = ?, updated_by = ?, updated_at = ? WHERE event_key = ? AND team_number = ?`).run(body.picked ? 1 : 0, request.hubUser!.name, now, eventKey, teamNumber);
    }
    if (typeof body.note === "string") {
      db.prepare(`UPDATE pick_list_entries SET note = ?, updated_by = ?, updated_at = ? WHERE event_key = ? AND team_number = ?`).run(body.note.slice(0, 300), request.hubUser!.name, now, eventKey, teamNumber);
    }
    publish({ eventKey, entity: "picks", key: eventKey, audience: ["strategy"] });
    return load(eventKey);
  });
}
