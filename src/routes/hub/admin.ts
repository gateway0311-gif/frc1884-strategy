import type { FastifyInstance } from "fastify";

import { db } from "../../db/client.js";
import { publish } from "../../hub/changeFeed.js";
import { configuredRoles, requirePermission } from "../../hub/session.js";
import { getActiveEvent, getEvent, getSetting, setSetting } from "../../hub/settings.js";
import { lastSync, syncEvent } from "../../hub/sync.js";
import { isTbaConfigured } from "../../integrations/tba.js";
import { GAMES, listGames } from "../../shared/games/index.js";

const EVENT_KEY = /^\d{4}[a-z0-9]{2,16}$/;

function overview() {
  const events = db
    .prepare(
      `SELECT e.event_key, e.name, e.season, e.location, e.start_date, e.end_date, e.game_id,
              (SELECT COUNT(*) FROM event_teams et WHERE et.event_key = e.event_key) AS team_count,
              (SELECT COUNT(*) FROM matches m WHERE m.event_key = e.event_key) AS match_count
       FROM events e
       ORDER BY COALESCE(e.start_date, '') DESC, e.id DESC`
    )
    .all() as Array<Record<string, string | number | null>>;
  const active = getActiveEvent();
  return {
    activeEventKey: active?.eventKey ?? null,
    events: events.map((e) => ({
      eventKey: e.event_key,
      name: e.name,
      season: e.season,
      location: e.location,
      startDate: e.start_date,
      endDate: e.end_date,
      gameId: e.game_id,
      teamCount: e.team_count,
      matchCount: e.match_count,
      lastSync: lastSync(String(e.event_key)),
      ourRobot: getSetting(`our_robot:${e.event_key}`) ?? "",
    })),
    games: listGames(),
    ourTeam: Number(getSetting("team_number") ?? 1884),
    autoSync: getSetting("auto_sync") !== "off",
    server: {
      tba: isTbaConfigured(),
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
      codes: configuredRoles(),
      sessionSecret: (process.env.SESSION_SECRET ?? "").length >= 16,
    },
  };
}

export async function hubAdminRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission("admin") };

  app.get("/admin/overview", guard, async () => overview());

  // Set up an event by its Blue Alliance key and import everything public about it.
  app.post("/admin/events", guard, async (request, reply) => {
    const body = (request.body ?? {}) as { eventKey?: unknown; gameId?: unknown; makeActive?: unknown };
    const eventKey = typeof body.eventKey === "string" ? body.eventKey.trim().toLowerCase() : "";
    if (!EVENT_KEY.test(eventKey)) return reply.code(400).send({ error: "invalid_event_key" });
    const gameId = typeof body.gameId === "string" && GAMES[body.gameId] ? body.gameId : null;
    if (!gameId) return reply.code(400).send({ error: "unknown_game" });

    db.prepare(
      `INSERT INTO events (event_key, name, season, source, game_id)
       VALUES (?, ?, ?, 'hub', ?)
       ON CONFLICT(event_key) DO UPDATE SET game_id = excluded.game_id, updated_at = CURRENT_TIMESTAMP`
    ).run(eventKey, eventKey, Number(eventKey.slice(0, 4)), gameId);

    const sync = await syncEvent(eventKey);
    if (body.makeActive !== false) {
      setSetting("active_event_key", eventKey);
      publish({ eventKey: null, entity: "session", key: "active_event", audience: ["scout"] });
    }
    return { event: getEvent(eventKey), sync };
  });

  app.put<{ Params: { eventKey: string } }>("/admin/events/:eventKey", guard, async (request, reply) => {
    const { eventKey } = request.params;
    if (!getEvent(eventKey)) return reply.code(404).send({ error: "event_not_found" });
    const body = (request.body ?? {}) as { gameId?: unknown; name?: unknown; ourRobot?: unknown };
    if (typeof body.ourRobot === "string") {
      // What our robot does at this event, in the lead's words. The AI briefs build on it.
      setSetting(`our_robot:${eventKey}`, body.ourRobot.trim().slice(0, 1500));
    }
    if (body.gameId !== undefined) {
      if (typeof body.gameId !== "string" || !GAMES[body.gameId]) return reply.code(400).send({ error: "unknown_game" });
      db.prepare(`UPDATE events SET game_id = ?, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?`).run(body.gameId, eventKey);
    }
    if (typeof body.name === "string" && body.name.trim()) {
      db.prepare(`UPDATE events SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?`).run(body.name.trim().slice(0, 120), eventKey);
    }
    publish({ eventKey: null, entity: "session", key: "active_event", audience: ["scout"] });
    return { event: getEvent(eventKey) };
  });

  app.put("/admin/active-event", guard, async (request, reply) => {
    const eventKey = (request.body as { eventKey?: unknown } | null)?.eventKey;
    if (typeof eventKey !== "string" || !getEvent(eventKey)) return reply.code(404).send({ error: "event_not_found" });
    setSetting("active_event_key", eventKey);
    publish({ eventKey: null, entity: "session", key: "active_event", audience: ["scout"] });
    return { activeEventKey: eventKey };
  });

  app.post<{ Params: { eventKey: string } }>("/admin/events/:eventKey/sync", guard, async (request, reply) => {
    const { eventKey } = request.params;
    if (!getEvent(eventKey)) return reply.code(404).send({ error: "event_not_found" });
    const statbotics = (request.body as { statbotics?: unknown } | null)?.statbotics !== false;
    return syncEvent(eventKey, { statbotics });
  });

  app.put("/admin/settings", guard, async (request, reply) => {
    const body = (request.body ?? {}) as { ourTeam?: unknown; autoSync?: unknown };
    if (body.ourTeam !== undefined) {
      const team = Number(body.ourTeam);
      if (!Number.isInteger(team) || team <= 0 || team > 99_999) return reply.code(400).send({ error: "invalid_team" });
      setSetting("team_number", String(team));
    }
    if (typeof body.autoSync === "boolean") setSetting("auto_sync", body.autoSync ? "on" : "off");
    publish({ eventKey: null, entity: "schedule", key: "settings", audience: ["scout"] });
    return overview();
  });
}
