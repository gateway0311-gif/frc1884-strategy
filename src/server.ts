import { buildApp } from "./app.js";
import { startAssignmentTicker } from "./hub/assign.js";
import { pruneChangeLog } from "./hub/changeFeed.js";
import { getActiveEvent } from "./hub/settings.js";
import { startAutoSync } from "./hub/sync.js";

const app = await buildApp();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  startAutoSync(getActiveEvent, (message) => app.log.warn(message));
  startAssignmentTicker(() => getActiveEvent()?.eventKey ?? null, (message) => app.log.warn(message));
  // The change log only needs to cover a short disconnect; trim it now and then.
  pruneChangeLog();
  setInterval(() => pruneChangeLog(), 15 * 60_000).unref();
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
