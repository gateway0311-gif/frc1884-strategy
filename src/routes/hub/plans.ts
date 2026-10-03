import type { FastifyInstance } from "fastify";

import { publish } from "../../hub/changeFeed.js";
import { requirePermission } from "../../hub/session.js";
import { findMatchPlanId, loadStrategyPlanWithVersions, upsertStrategyPlan } from "../helpers.js";

interface PhaseInput {
  pos?: unknown;
  strokes?: unknown;
  notes?: unknown;
}

// Keeps a plan to a sensible size and shape whatever the browser sends.
function cleanPhase(input: unknown): { pos: Record<string, { x: number; y: number }>; strokes: Array<{ pts: Array<{ x: number; y: number }>; color: string; width: number }>; notes: string } | null {
  if (!input || typeof input !== "object") return null;
  const phase = input as PhaseInput;
  const pos: Record<string, { x: number; y: number }> = {};
  if (phase.pos && typeof phase.pos === "object") {
    for (const [team, point] of Object.entries(phase.pos as Record<string, { x?: unknown; y?: unknown }>).slice(0, 12)) {
      if (/^\d{1,5}$/.test(team) && typeof point?.x === "number" && typeof point?.y === "number") pos[team] = { x: point.x, y: point.y };
    }
  }
  const strokes = Array.isArray(phase.strokes)
    ? phase.strokes.slice(0, 200).flatMap((stroke: { pts?: unknown; color?: unknown; width?: unknown }) => {
        if (!Array.isArray(stroke?.pts)) return [];
        const pts = stroke.pts
          .slice(0, 600)
          .filter((p: { x?: unknown; y?: unknown }) => typeof p?.x === "number" && typeof p?.y === "number")
          .map((p: { x: number; y: number }) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
        if (pts.length < 2) return [];
        const color = typeof stroke.color === "string" && /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : "#ffffff";
        return [{ pts, color, width: typeof stroke.width === "number" ? Math.min(12, Math.max(1, stroke.width)) : 3.5 }];
      })
    : [];
  return { pos, strokes, notes: typeof phase.notes === "string" ? phase.notes.slice(0, 2000) : "" };
}

// Match plans: robot positions, sketches and notes for auto and teleop.
// Shared live between everyone on the strategy page.
export async function hubPlanRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission("strategy") };
  type Params = { eventKey: string; matchKey: string };

  app.get<{ Params: Params }>("/events/:eventKey/plans/:matchKey", guard, async (request) => {
    const planId = findMatchPlanId(request.params.eventKey, request.params.matchKey);
    return { plan: planId ? loadStrategyPlanWithVersions(planId) : null };
  });

  app.put<{ Params: Params }>("/events/:eventKey/plans/:matchKey", guard, async (request, reply) => {
    const { eventKey, matchKey } = request.params;
    const body = (request.body ?? {}) as { phases?: { auto?: unknown; teleop?: unknown }; clientId?: unknown };
    const phases: { auto?: unknown; teleop?: unknown } = {};
    const auto = cleanPhase(body.phases?.auto);
    const teleop = cleanPhase(body.phases?.teleop);
    if (auto) phases.auto = auto;
    if (teleop) phases.teleop = teleop;
    if (!auto && !teleop) return reply.code(400).send({ error: "nothing_to_save" });

    const result = upsertStrategyPlan(eventKey, "scheduled_match", { matchKey, title: `Plan for ${matchKey}`, phases, updatedBy: request.hubUser!.name });
    if (!result.ok) return reply.code(404).send({ error: result.error });
    publish({
      eventKey,
      entity: "plan",
      key: matchKey,
      audience: ["strategy"],
      payload: { clientId: typeof body.clientId === "string" ? body.clientId.slice(0, 64) : null, by: request.hubUser!.name },
    });
    return { plan: loadStrategyPlanWithVersions(result.planId) };
  });
}
