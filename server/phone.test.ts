import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";

const phone = { twilioSid: "ACx", twilioToken: "tok", twilioFrom: "+4930123456", openaiProjectId: "proj_1", webhookSecret: "whsec" };
const mk = (withPhone: boolean) => {
  const config: Config = {
    openaiApiKey: "k", appPassword: "geheim", sessionSecret: "s".repeat(32), haMcpUrl: "http://ha",
    haConfirmEntities: [], haEntityAllowlist: null, liveBackendModel: "m", port: 8080, phone: withPhone ? phone : undefined,
  };
  return createApp({ config, live: { create: async () => ({ id: "x", sdp: "y" }) }, ha: { callTool: async () => null }, now: () => 0 });
};
const call = async (app: ReturnType<typeof mk>, body: unknown) => {
  const login = await app.request("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "geheim" }) });
  return app.request("/api/call", { method: "POST", headers: { "content-type": "application/json", cookie: login.headers.get("set-cookie")!.split(";")[0] }, body: JSON.stringify(body) });
};

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/call", () => {
  it("verlangt Auth", async () => {
    expect((await mk(true).request("/api/call", { method: "POST", body: "{}" })).status).toBe(401);
  });
  it("501 ohne Telefonie-Config", async () => {
    expect((await call(mk(false), { number: "+491701234567" })).status).toBe(501);
  });
  it("400 bei ungueltiger Nummer", async () => {
    for (const number of ["0170123", "+49 170 123", "", 5]) expect((await call(mk(true), { number })).status).toBe(400);
  });
  it("ruft Twilio mit Ziel, Absender und SIP-TwiML auf", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", f);
    expect((await call(mk(true), { number: "+491701234567" })).status).toBe(204);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/Accounts/ACx/Calls.json");
    const body = init.body as URLSearchParams;
    expect(body.get("To")).toBe("+491701234567");
    expect(body.get("From")).toBe("+4930123456");
    expect(body.get("Twiml")).toContain("sip:proj_1@sip.api.openai.com");
  });
  it("502 wenn Twilio ablehnt", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    expect((await call(mk(true), { number: "+491701234567" })).status).toBe(502);
  });
});

describe("POST /webhooks/openai", () => {
  it("400 bei ungueltiger Signatur", async () => {
    expect((await mk(true).request("/webhooks/openai", { method: "POST", body: "{}" })).status).toBe(400);
  });
});
