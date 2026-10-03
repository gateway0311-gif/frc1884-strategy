import type { FastifyInstance } from "fastify";

import { hubAdminRoutes } from "./admin.js";
import { hubAnalysisRoutes } from "./analysis.js";
import { hubAuthRoutes } from "./auth.js";
import { hubLiveRoutes } from "./live.js";
import { hubManagerRoutes } from "./manager.js";
import { hubPitRoutes } from "./pit.js";
import { hubScheduleRoutes } from "./schedule.js";
import { hubScoutRoutes } from "./scout.js";

// Everything the hub page talks to lives under /api/hub.
export async function hubRoutes(app: FastifyInstance) {
  await app.register(hubAuthRoutes);
  await app.register(hubLiveRoutes);
  await app.register(hubScheduleRoutes);
  await app.register(hubScoutRoutes);
  await app.register(hubManagerRoutes);
  await app.register(hubPitRoutes);
  await app.register(hubAnalysisRoutes);
  await app.register(hubAdminRoutes);
}
