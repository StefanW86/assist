import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { buildSessionConfig, type LiveClient } from "./live.ts";

const config: Config = {
  openaiApiKey: "sk-SECRETKEY",
  appPassword: "geheim",
  sessionSecret: "s3cret",
  haMcpUrl: "http://ha",
  haToken: "HATOKEN123",
  haConfirmEntities: [],
  haEntityAllowlist: null,
  liveBackendModel: "backend-model-x",
  port: 8080,
};

describe("buildSessionConfig", () => {
  const s = buildSessionConfig(config) as any;

  it("nutzt gpt-live-1 mit Responses-Delegation und Backend-Modell aus der Config", () => {
    expect(s.model).toBe("gpt-live-1");
    expect(typeof s.instructions).toBe("string");
    expect(s.delegation.type).toBe("responses");
    expect(s.delegation.responses.model).toBe("backend-model-x");
    expect(s.delegation.responses.instructions).toContain("confirm_action");
  });

  it("enthaelt web_search und die vier HA-Tools", () => {
    const tools = s.delegation.responses.tools;
    expect(tools).toContainEqual({ type: "web_search" });
    const names = tools.filter((t: any) => t.type === "function").map((t: any) => t.name);
    expect(names.sort()).toEqual(["confirm_action", "ha_call_service", "ha_get_state", "ha_search"]);
  });

  it("setzt strict: false auf allen HA-Function-Tools", () => {
    const fns = s.delegation.responses.tools.filter((t: any) => t.type === "function");
    expect(fns).toHaveLength(4);
    for (const t of fns) expect(t.strict).toBe(false);
  });

  it("enthaelt keine Geheimnisse", () => {
    const json = JSON.stringify(s);
    for (const secret of ["sk-SECRETKEY", "HATOKEN123", "geheim", "s3cret"]) expect(json).not.toContain(secret);
  });
});

describe("POST /api/session", () => {
  const mk = (live: LiveClient) => createApp({ config, live, ha: { callTool: async () => null }, now: () => 0 });
  const cookieFor = async (app: ReturnType<typeof mk>) => {
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "geheim" }),
    });
    return res.headers.get("set-cookie")!.split(";")[0];
  };
  const post = (app: ReturnType<typeof mk>, body: unknown, cookie?: string) =>
    app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

  it("verlangt Auth", async () => {
    const app = mk({ create: async () => ({ id: "x", sdp: "y" }) });
    expect((await post(app, { sdp: "offer" })).status).toBe(401);
  });

  it("400 ohne sdp", async () => {
    const app = mk({ create: async () => ({ id: "x", sdp: "y" }) });
    expect((await post(app, {}, await cookieFor(app))).status).toBe(400);
  });

  it("gibt die SDP-Antwort zurueck und reicht Offer und Session-Config durch", async () => {
    let seen: { session: any; sdp: string } | undefined;
    const app = mk({
      create: async (session, sdp) => {
        seen = { session, sdp };
        return { id: "live_123", sdp: "answer" };
      },
    });
    const res = await post(app, { sdp: "offer" }, await cookieFor(app));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sdp: "answer", id: "live_123" });
    expect(seen!.sdp).toBe("offer");
    expect(seen!.session.model).toBe("gpt-live-1");
  });

  it("502 ohne Upstream-Fehlertext", async () => {
    const app = mk({
      create: async () => {
        throw new Error("Incorrect API key provided: sk-SECRETKEY");
      },
    });
    const res = await post(app, { sdp: "offer" }, await cookieFor(app));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("sk-SECRETKEY");
    expect(JSON.parse(text).error).toBeTruthy();
  });
});
