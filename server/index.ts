import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createHaClient } from "./ha/client.ts";
import { createLiveClient } from "./live.ts";

if (existsSync(".env")) process.loadEnvFile();

const config = loadConfig(process.env);
const app = createApp({
  config,
  live: createLiveClient(config.openaiApiKey),
  ha: createHaClient(config.haMcpUrl, config.haToken),
});

// Static frontend from dist/ (relative to cwd); SPA fallback for every non-API GET.
app.use("*", serveStatic({ root: "./dist" }));
app.get("*", (c, next) => (c.req.path.startsWith("/api") ? next() : serveStatic({ path: "./dist/index.html" })(c, next)));

serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`assist läuft auf Port ${info.port}`));
