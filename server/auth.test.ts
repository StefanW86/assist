import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { requireAuth } from "./auth.ts";
import type { Config } from "./config.ts";

const config: Config = {
  openaiApiKey: "k",
  appPassword: "geheim",
  sessionSecret: "s3cret",
  haMcpUrl: "http://ha",
  haConfirmEntities: [],
  haEntityAllowlist: null,
  liveBackendModel: "m",
  port: 8080,
};

const mk = (now = () => 0) => createApp({ config, live: undefined as never, ha: { callTool: async () => null }, now });
const login = (app: ReturnType<typeof mk>, password: string, ip = "1.2.3.4") =>
  app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ password }),
  });

describe("auth", () => {
  it("lehnt falsches Kennwort ab, akzeptiert richtiges mit Cookie-Flags", async () => {
    const app = mk();
    expect((await login(app, "falsch")).status).toBe(401);
    const res = await login(app, "geheim");
    expect(res.status).toBe(204);
    const c = res.headers.get("set-cookie")!;
    for (const part of ["assist_session", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=2592000"]) {
      expect(c).toContain(part);
    }
  });

  it("/api/me prueft das Cookie", async () => {
    const app = mk();
    expect((await app.request("/api/me")).status).toBe(401);
    const cookie = (await login(app, "geheim")).headers.get("set-cookie")!.split(";")[0];
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(204);
    const bad = cookie.slice(0, -3) + "xxx";
    expect((await app.request("/api/me", { headers: { cookie: bad } })).status).toBe(401);
  });

  it("sperrt nach 5 Fehlversuchen pro IP fuer 15 Minuten", async () => {
    let t = 0;
    const app = mk(() => t);
    for (let i = 0; i < 5; i++) expect((await login(app, "falsch")).status).toBe(401);
    expect((await login(app, "geheim")).status).toBe(429);
    expect((await login(app, "geheim", "9.9.9.9")).status).toBe(204);
    t += 15 * 60 * 1000;
    expect((await login(app, "geheim")).status).toBe(204);
  });
  it("Lockout haelt bei parallelen Fehlversuchen", async () => {
    const app = mk();
    await Promise.all(Array.from({ length: 10 }, () => login(app, "falsch")));
    expect((await login(app, "geheim")).status).toBe(429);
  });

  it("Session laeuft nach 30 Tagen ab", async () => {
    let t = 0;
    const app = mk(() => t);
    const cookie = (await login(app, "geheim")).headers.get("set-cookie")!.split(";")[0];
    t = 30 * 24 * 3600 * 1000 - 1;
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(204);
    t += 2;
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("requireAuth schuetzt Routen", async () => {
    const app = mk();
    const prot = new Hono();
    prot.use("*", requireAuth(config, () => 0));
    prot.get("/x", (c) => c.text("ok"));
    expect((await prot.request("/x")).status).toBe(401);
    const cookie = (await login(app, "geheim")).headers.get("set-cookie")!.split(";")[0];
    expect((await prot.request("/x", { headers: { cookie } })).status).toBe(200);
  });
});
