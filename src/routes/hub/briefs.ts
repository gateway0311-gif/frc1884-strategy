import type { FastifyInstance } from "fastify";

import { briefStatus, generateBrief, isBriefKind } from "../../hub/briefs.js";
import { requirePermission } from "../../hub/session.js";
import { ClaudeCredentialsMissingError } from "../../integrations/claudeBrief.js";

// AI briefs. Strategists and leads only, because each one costs money to write.
export async function hubBriefRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission("strategy") };
  type Params = { eventKey: string; kind: string; subject: string };

  app.get<{ Params: Params }>("/events/:eventKey/briefs/:kind/:subject", guard, async (request, reply) => {
    const { eventKey, kind, subject } = request.params;
    if (!isBriefKind(kind)) return reply.code(404).send({ error: "unknown_brief" });
    const status = briefStatus(eventKey, kind, subject);
    if (!status) return reply.code(404).send({ error: "brief_subject_not_found" });
    return status;
  });

  app.post<{ Params: Params }>("/events/:eventKey/briefs/:kind/:subject", guard, async (request, reply) => {
    const { eventKey, kind, subject } = request.params;
    if (!isBriefKind(kind)) return reply.code(404).send({ error: "unknown_brief" });
    const force = (request.body as { force?: unknown } | null)?.force === true;
    try {
      const status = await generateBrief(eventKey, kind, subject, { force, by: request.hubUser!.name });
      if (!status) return reply.code(404).send({ error: "brief_subject_not_found" });
      return status;
    } catch (error) {
      if (error instanceof ClaudeCredentialsMissingError) return reply.code(503).send({ error: "anthropic_key_not_configured" });
      request.log.error({ error }, "brief generation failed");
      return reply.code(502).send({ error: "brief_failed", message: error instanceof Error ? error.message.slice(0, 200) : "failed" });
    }
  });
}
