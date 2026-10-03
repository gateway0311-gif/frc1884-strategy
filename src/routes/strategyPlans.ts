import type { FastifyPluginAsync } from "fastify";

import { db } from "../db/client.js";
import type { StrategyPlanUpsertBody } from "../types/domain.js";
import { loadStrategyPlanWithVersions, upsertStrategyPlan } from "./helpers.js";

export const strategyPlanRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { eventKey: string };
    Querystring: { matchKey?: string; scope?: string };
  }>("/events/:eventKey/strategy-plans", async (request) => {
    const rows = db
      .prepare(`
        SELECT
          sp.id
        FROM strategy_plans sp
        LEFT JOIN matches m ON m.id = sp.match_id
        WHERE sp.event_key = ?
          AND (? IS NULL OR sp.scope = ?)
          AND (? IS NULL OR m.match_key = ?)
        ORDER BY sp.updated_at DESC
      `)
      .all(
        request.params.eventKey,
        request.query.scope ?? null,
        request.query.scope ?? null,
        request.query.matchKey ?? null,
        request.query.matchKey ?? null
      ) as Array<{ id: number }>;

    return {
      strategyPlans: rows
        .map((row) => loadStrategyPlanWithVersions(row.id))
        .filter(Boolean)
    };
  });

  app.put<{
    Params: { eventKey: string; scope: string };
    Body: StrategyPlanUpsertBody;
  }>("/events/:eventKey/strategy-plans/:scope", async (request, reply) => {
    const { eventKey, scope } = request.params;
    const body = request.body ?? {};

    if (!["scheduled_match", "free_play"].includes(scope)) {
      return reply.code(400).send({ error: "invalid_scope" });
    }

    if (scope === "scheduled_match" && !body.matchKey) {
      return reply.code(400).send({ error: "match_key_required_for_scheduled_match" });
    }

    const result = upsertStrategyPlan(eventKey, scope as "scheduled_match" | "free_play", body);
    if (!result.ok) {
      return reply.code(404).send({ error: result.error });
    }
    const planId = result.planId;

    const plan = loadStrategyPlanWithVersions(planId);

    return reply.code(200).send({ strategyPlan: plan });
  });
};
