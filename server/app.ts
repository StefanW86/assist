import { Hono } from "hono";
import { authRoutes, requireAuth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { HaClient } from "./ha/client.ts";
import { ConfirmationStore } from "./ha/guard.ts";
import { haRoutes } from "./ha/routes.ts";

// Platzhalter, wird in Task 5 (LiveClient) ersetzt.
export type LiveClient = unknown;

export type AppDeps = { config: Config; live: LiveClient; ha: HaClient; now?: () => number };

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const app = new Hono();
  app.route("/api", authRoutes(deps.config, now));
  const auth = requireAuth(deps.config, now);
  app.use("/api/tools/*", auth);
  app.use("/api/transcript", auth);
  app.route("/api", haRoutes(deps.ha, deps.config, new ConfirmationStore(now)));
  return app;
}
