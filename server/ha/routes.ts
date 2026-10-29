import { Hono } from "hono";
import type { Config } from "../config.ts";
import type { HaClient } from "./client.ts";
import { needsConfirmation, type ConfirmationStore, type PendingAction } from "./guard.ts";

type Args = Record<string, unknown>;
type EntityRecord = { entity_id: string; state?: unknown; attributes?: { device_class?: string; friendly_name?: string } };

// Keys that would retarget a service call away from the checked entity_id.
const TARGET_KEYS = ["entity_id", "device_id", "area_id", "floor_id", "label_id", "target", "entities"];

const fail = (msg: string): never => {
  throw new Error(msg);
};

const str = (v: unknown, name: string): string => (typeof v === "string" && v ? v : fail(`invalid_${name}`));

function entityId(v: unknown): string {
  if (Array.isArray(v) || (typeof v === "string" && /[\s,]/.test(v))) fail("single_entity_only");
  return str(v, "entity_id");
}

export function haRoutes(ha: HaClient, config: Config, store: ConfirmationStore): Hono {
  const allowed = (id: string) => !config.haEntityAllowlist || config.haEntityAllowlist.includes(id);

  async function getState(id: string): Promise<EntityRecord> {
    if (!allowed(id)) fail("entity_not_allowed");
    const raw = (await ha.callTool("ha_get_state", { entity_id: id })) as { data?: unknown } | null;
    const rec = (raw && typeof raw === "object" && "data" in raw ? raw.data : raw) as EntityRecord | null;
    if (!rec || typeof rec !== "object" || rec.entity_id !== id) fail("entity_not_found");
    return rec!;
  }

  const callService = (a: PendingAction) =>
    ha.callTool("ha_call_service", {
      domain: a.domain,
      service: a.service,
      entity_id: a.entity_id,
      ...(a.data ? { data: a.data } : {}),
    });

  const tools: Record<string, (args: Args) => Promise<unknown>> = {
    async ha_search(args) {
      const res = (await ha.callTool("ha_search", {
        query: str(args.query, "query"),
        limit: 20,
        result_fields: ["entity_id", "friendly_name", "domain", "state", "area"],
      })) as { entities?: { entity_id: string }[] } | null;
      return (res?.entities ?? []).filter((e) => allowed(e.entity_id));
    },

    ha_get_state: (args) => getState(entityId(args.entity_id)),

    async ha_call_service(args) {
      const domain = str(args.domain, "domain");
      const service = str(args.service, "service");
      const entity_id = entityId(args.entity_id);
      const data = args.data;
      if (data !== undefined && (data === null || typeof data !== "object" || Array.isArray(data))) fail("invalid_data");
      if (data && TARGET_KEYS.some((k) => k in (data as object))) fail("targeting_in_data_not_allowed");
      // e.g. script.open_door with a harmless light as entity_id would bypass the guard
      if (domain !== entity_id.split(".")[0] && domain !== "homeassistant") fail("domain_mismatch");

      const rec = await getState(entity_id);
      const name = rec.attributes?.friendly_name ?? entity_id;
      const action: PendingAction = {
        domain,
        service,
        entity_id,
        ...(data ? { data: data as Args } : {}),
        description: `${name}: ${domain}.${service}`,
      };
      if (needsConfirmation(rec, config.haConfirmEntities)) {
        return { status: "confirmation_required", action_id: store.create(action), description: action.description };
      }
      return { status: "done", result: await callService(action) };
    },

    async confirm_action(args) {
      const res = store.take(str(args.action_id, "action_id"));
      if ("error" in res) return res;
      await callService(res);
      return { status: "done" };
    },
  };

  const app = new Hono();

  app.post("/tools/:name", async (c) => {
    const tool = Object.hasOwn(tools, c.req.param("name")) ? tools[c.req.param("name")] : undefined;
    if (!tool) return c.json({ error: "unknown_tool" });
    const args = await c.req.json().catch(() => null);
    if (!args || typeof args !== "object" || Array.isArray(args)) return c.json({ error: "invalid_body" });
    try {
      return c.json((await tool(args)) as object);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/transcript", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.text !== "string") return c.json({ error: "invalid_text" });
    store.addUtterance(body.text);
    return c.body(null, 204);
  });

  return app;
}
