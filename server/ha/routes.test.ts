import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import type { Config } from "../config.ts";
import type { HaClient } from "./client.ts";

const base: Config = {
  openaiApiKey: "k",
  appPassword: "geheim",
  sessionSecret: "s3cret",
  haMcpUrl: "http://ha",
  haConfirmEntities: [],
  haEntityAllowlist: null,
  liveBackendModel: "m",
  port: 8080,
};

const STATES: Record<string, unknown> = {
  "light.wohnzimmer": { entity_id: "light.wohnzimmer", state: "off", attributes: { friendly_name: "Wohnzimmer" } },
  "light.kueche": { entity_id: "light.kueche", state: "off", attributes: {} },
  // ha-mcp may wrap single-entity results in { data }
  "lock.haustuer": { data: { entity_id: "lock.haustuer", state: "locked", attributes: { friendly_name: "Haustür" } } },
  "cover.garage": { entity_id: "cover.garage", state: "closed", attributes: { device_class: "garage" } },
};

function fakeHa(opts: { throws?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ha: HaClient = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (opts.throws) throw new Error("ha down");
      if (name === "ha_get_state") return STATES[args.entity_id as string] ?? null;
      if (name === "ha_search")
        return { entities: [{ entity_id: "light.wohnzimmer" }, { entity_id: "light.kueche" }], scripts: [] };
      if (name === "ha_call_service") return { success: true };
      throw new Error("unexpected tool");
    },
  };
  const services = () => calls.filter((c) => c.name === "ha_call_service");
  return { ha, calls, services };
}

async function setup(cfg: Partial<Config> = {}, opts: { throws?: boolean } = {}) {
  const f = fakeHa(opts);
  let t = 0;
  const app = createApp({ config: { ...base, ...cfg }, live: undefined as never, ha: f.ha, now: () => t });
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "geheim" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const post = (path: string, body: unknown, withCookie = true) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(withCookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const tool = async (name: string, body: unknown) => {
    const r = await post(`/api/tools/${name}`, body);
    expect(r.status).toBe(200);
    return r.json() as Promise<any>;
  };
  return { ...f, post, tool, advance: (ms: number) => (t += ms) };
}

describe("HA tool endpoints", () => {
  it("ohne Cookie -> 401", async () => {
    const s = await setup();
    expect((await s.post("/api/tools/ha_get_state", { entity_id: "light.wohnzimmer" }, false)).status).toBe(401);
    expect((await s.post("/api/transcript", { text: "Ja" }, false)).status).toBe(401);
    expect(s.calls).toEqual([]);
  });

  it("ha_call_service auf Licht wird direkt ausgefuehrt, nur erlaubte Argumente", async () => {
    const s = await setup();
    const r = await s.tool("ha_call_service", {
      domain: "light",
      service: "turn_on",
      entity_id: "light.wohnzimmer",
      data: { brightness: 100 },
      ws_command: { type: "evil" },
      return_response: true,
    });
    expect(r).toEqual({ status: "done", result: { success: true } });
    expect(s.services()).toEqual([
      {
        name: "ha_call_service",
        args: { domain: "light", service: "turn_on", entity_id: "light.wohnzimmer", data: { brightness: 100 } },
      },
    ]);
  });

  it("Schloss braucht Bestaetigung: erst nach 'Ja' genau ein Aufruf", async () => {
    const s = await setup();
    const r = await s.tool("ha_call_service", { domain: "lock", service: "unlock", entity_id: "lock.haustuer" });
    expect(r.status).toBe("confirmation_required");
    expect(typeof r.action_id).toBe("string");
    expect(r.description).toContain("Haustür");
    expect(s.services()).toEqual([]);

    expect((await s.post("/api/transcript", { text: "Ja" })).status).toBe(204);
    expect(await s.tool("confirm_action", { action_id: r.action_id })).toEqual({ status: "done" });
    expect(s.services()).toEqual([
      { name: "ha_call_service", args: { domain: "lock", service: "unlock", entity_id: "lock.haustuer" } },
    ]);
    // replay is refused
    expect(await s.tool("confirm_action", { action_id: r.action_id })).toEqual({ error: "unknown" });
    expect(s.services().length).toBe(1);
  });

  it("Garagentor (device_class garage) und HA_CONFIRM_ENTITIES brauchen Bestaetigung", async () => {
    const s = await setup({ haConfirmEntities: ["light.kueche"] });
    for (const [domain, entity_id] of [["cover", "cover.garage"], ["light", "light.kueche"]]) {
      const r = await s.tool("ha_call_service", { domain, service: "turn_on", entity_id });
      expect(r.status).toBe("confirmation_required");
    }
    expect(s.services()).toEqual([]);
  });

  it("confirm_action ohne 'Ja' -> not_confirmed, kein Aufruf", async () => {
    const s = await setup();
    const r = await s.tool("ha_call_service", { domain: "lock", service: "unlock", entity_id: "lock.haustuer" });
    expect(await s.tool("confirm_action", { action_id: r.action_id })).toEqual({ error: "not_confirmed" });
    expect(await s.tool("confirm_action", { action_id: "nope" })).toEqual({ error: "unknown" });
    s.advance(61_000);
    await s.post("/api/transcript", { text: "Ja" });
    expect(await s.tool("confirm_action", { action_id: r.action_id })).toEqual({ error: "expired" });
    expect(s.services()).toEqual([]);
  });

  it("Allowlist: verbotene Entitaet wird nicht geschaltet, Suche gefiltert", async () => {
    const s = await setup({ haEntityAllowlist: ["light.wohnzimmer"] });
    const r = await s.tool("ha_call_service", { domain: "light", service: "turn_on", entity_id: "light.kueche" });
    expect(r.error).toBeTruthy();
    expect(await s.tool("ha_get_state", { entity_id: "light.kueche" })).toHaveProperty("error");
    expect(s.services()).toEqual([]);

    expect(await s.tool("ha_search", { query: "licht" })).toEqual([{ entity_id: "light.wohnzimmer" }]);
    expect(s.calls.find((c) => c.name === "ha_search")!.args).toEqual({
      query: "licht",
      limit: 20,
      result_fields: ["entity_id", "friendly_name", "domain", "state", "area"],
    });
  });

  it("ha_search ohne Allowlist liefert alle Entitaeten, ha_get_state entpackt .data", async () => {
    const s = await setup();
    expect((await s.tool("ha_search", { query: "x" })).length).toBe(2);
    expect(await s.tool("ha_get_state", { entity_id: "lock.haustuer" })).toMatchObject({ state: "locked" });
    expect(s.calls.find((c) => c.name === "ha_get_state")!.args).toEqual({ entity_id: "lock.haustuer" });
  });

  it("nur eine Entitaet pro Aufruf", async () => {
    const s = await setup();
    for (const entity_id of ["light.wohnzimmer,lock.haustuer", "light.wohnzimmer lock.haustuer", ["lock.haustuer"]]) {
      const r = await s.tool("ha_call_service", { domain: "light", service: "turn_on", entity_id });
      expect(r).toEqual({ error: "single_entity_only" });
      expect(await s.tool("ha_get_state", { entity_id })).toEqual({ error: "single_entity_only" });
    }
    expect(s.calls).toEqual([]);
  });

  it("Ziel-Schluessel in data werden abgelehnt", async () => {
    const s = await setup();
    for (const key of ["entity_id", "device_id", "area_id", "floor_id", "label_id", "target", "entities"]) {
      const r = await s.tool("ha_call_service", {
        domain: "light",
        service: "turn_on",
        entity_id: "light.wohnzimmer",
        data: { [key]: "lock.haustuer" },
      });
      expect(r).toEqual({ error: "targeting_in_data_not_allowed" });
    }
    expect(s.services()).toEqual([]);
  });

  it("Service-Domain muss zur Entitaet passen (z.B. kein script.* auf ein Licht)", async () => {
    const s = await setup();
    const r = await s.tool("ha_call_service", { domain: "script", service: "tuer_auf", entity_id: "light.wohnzimmer" });
    expect(r).toEqual({ error: "domain_mismatch" });
    const ok = await s.tool("ha_call_service", { domain: "homeassistant", service: "turn_off", entity_id: "light.wohnzimmer" });
    expect(ok.status).toBe("done");
    expect(s.services().length).toBe(1);
  });

  it("unbekannter Zustand -> Fehler, kein Service-Aufruf", async () => {
    const s = await setup();
    const r = await s.tool("ha_call_service", { domain: "light", service: "turn_on", entity_id: "light.gibtsnicht" });
    expect(r.error).toBeTruthy();
    expect(s.services()).toEqual([]);
  });

  it("Fake wirft -> 200 mit error", async () => {
    const s = await setup({}, { throws: true });
    expect(await s.tool("ha_get_state", { entity_id: "light.wohnzimmer" })).toEqual({ error: "ha down" });
    expect(await s.tool("ha_search", { query: "x" })).toEqual({ error: "ha down" });
    expect((await s.tool("ha_call_service", { domain: "light", service: "turn_on", entity_id: "light.wohnzimmer" })).error).toBe(
      "ha down",
    );
  });

  it("unbekanntes Tool und kaputter Body", async () => {
    const s = await setup();
    expect(await s.tool("ha_restart", {})).toEqual({ error: "unknown_tool" });
    expect(await s.tool("ha_get_state", {})).toHaveProperty("error");
    expect(await s.tool("ha_call_service", { domain: "light", service: "turn_on", entity_id: "light.wohnzimmer", data: "x" })).toHaveProperty("error");
    expect(s.calls).toEqual([]);
  });
});
