import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authRoutes, requireAuth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { HaClient } from "./ha/client.ts";
import { ConfirmationStore } from "./ha/guard.ts";
import { haRoutes } from "./ha/routes.ts";
import { buildSessionConfig, type LiveClient } from "./live.ts";
import { callRoutes } from "./phone.ts";

export type AppDeps = { config: Config; live: LiveClient; ha: HaClient; now?: () => number };

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const app = new Hono();
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.body(null, 413) }));
  app.use("/api/*", requireAuth(deps.config, now, ["/api/login", "/api/me", "/api/logout"]));
  app.route("/api", authRoutes(deps.config, now));
  app.post("/api/session", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.sdp !== "string" || !body.sdp) return c.json({ error: "invalid_sdp" }, 400);
    try {
      const { id, sdp } = await deps.live.create(buildSessionConfig(deps.config), body.sdp);
      return c.json({ sdp, id });
    } catch (e) {
      // only the status: upstream messages may echo (masked) key material
      console.error("live session create failed", (e as { status?: number })?.status ?? "");
      return c.json({ error: "live_session_failed" }, 502);
    }
  });
  app.route("/", callRoutes(deps.config));
  app.route("/api", haRoutes(deps.ha, deps.config, new ConfirmationStore(now)));
  return app;
}
