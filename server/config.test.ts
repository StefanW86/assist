import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const base = {
  OPENAI_API_KEY: "k",
  APP_PASSWORD: "p",
  SESSION_SECRET: "s".repeat(32),
  HA_MCP_URL: "http://ha/mcp",
};

describe("loadConfig", () => {
  for (const name of Object.keys(base)) {
    it(`wirft wenn ${name} fehlt`, () => {
      const env: Record<string, string | undefined> = { ...base };
      delete env[name];
      expect(() => loadConfig(env)).toThrow(name);
    });
  }

  it("SESSION_SECRET braucht mindestens 32 Zeichen", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "s".repeat(31) })).toThrow("SESSION_SECRET");
  });

  it("setzt Defaults", () => {
    const c = loadConfig(base);
    expect(c.liveBackendModel).toBe("gpt-6-luna");
    expect(c.port).toBe(8080);
    expect(c.haConfirmEntities).toEqual([]);
    expect(c.haEntityAllowlist).toBeNull();
    expect(c.haToken).toBeUndefined();
  });

  it("parst Listen", () => {
    const c = loadConfig({ ...base, HA_CONFIRM_ENTITIES: " switch.garage , lock.x", HA_ENTITY_ALLOWLIST: "" });
    expect(c.haConfirmEntities).toEqual(["switch.garage", "lock.x"]);
    expect(c.haEntityAllowlist).toBeNull();
    expect(loadConfig({ ...base, HA_ENTITY_ALLOWLIST: "a.b, c.d", PORT: "9000" })).toMatchObject({
      haEntityAllowlist: ["a.b", "c.d"],
      port: 9000,
    });
  });
});
