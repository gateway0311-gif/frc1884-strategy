import type { FastifyInstance } from "fastify";

import { dashboard, matchOutlook, teamDetail } from "../../hub/analysis.js";
import { loadEventData } from "../../hub/compile.js";
import { requirePermission } from "../../hub/session.js";
import { getSetting } from "../../hub/settings.js";

function ourTeam(): number {
  return Number(getSetting("team_number") ?? 1884);
}

// The strategy page. Strategists and leads only: scouts and scout managers
// cannot read compiled data.
export async function hubAnalysisRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission("strategy") };

  app.get<{ Params: { eventKey: string } }>("/events/:eventKey/analysis/dashboard", guard, async (request, reply) => {
    const data = loadEventData(request.params.eventKey);
    if (!data) return reply.code(404).send({ error: "event_not_found" });
    return dashboard(data, ourTeam(), Date.now());
  });

  app.get<{ Params: { eventKey: string } }>("/events/:eventKey/analysis/teams", guard, async (request, reply) => {
    const data = loadEventData(request.params.eventKey);
    if (!data) return reply.code(404).send({ error: "event_not_found" });
    return { ...data.compiled, ourTeam: ourTeam() };
  });

  app.get<{ Params: { eventKey: string; teamNumber: string } }>("/events/:eventKey/analysis/teams/:teamNumber", guard, async (request, reply) => {
    const data = loadEventData(request.params.eventKey);
    if (!data) return reply.code(404).send({ error: "event_not_found" });
    const detail = teamDetail(data, Number(request.params.teamNumber), Date.now());
    if (!detail) return reply.code(404).send({ error: "team_not_found" });
    return detail;
  });

  app.get<{ Params: { eventKey: string; matchKey: string } }>("/events/:eventKey/analysis/matches/:matchKey", guard, async (request, reply) => {
    const data = loadEventData(request.params.eventKey);
    if (!data) return reply.code(404).send({ error: "event_not_found" });
    const outlook = matchOutlook(data, request.params.matchKey, ourTeam());
    if (!outlook) return reply.code(404).send({ error: "match_not_found" });
    const numbers = new Set([...outlook.red.teams, ...outlook.blue.teams].map((t) => t.teamNumber));
    return { outlook, teams: data.compiled.teams.filter((t) => numbers.has(t.teamNumber)), ourTeam: ourTeam() };
  });
}
