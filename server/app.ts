import { Hono } from "hono";
import { authRoutes } from "./auth.ts";
import type { Config } from "./config.ts";

// Platzhalter, werden in Task 5 (LiveClient) bzw. Task 4 (HaClient) ersetzt.
export type LiveClient = unknown;
export type HaClient = unknown;

export type AppDeps = { config: Config; live: LiveClient; ha: HaClient; now?: () => number };

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const app = new Hono();
  app.route("/api", authRoutes(deps.config, now));
  return app;
}
