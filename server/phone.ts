// Ausgehender Anruf: Twilio ruft die Nummer an und verbindet nach dem Abheben per <Dial><Sip> mit OpenAI.
// OpenAI meldet den Anruf per Webhook (live.transport.incoming); wir nehmen ihn an, wenn er von uns stammt.
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import OpenAI from "openai";
import type { Config } from "./config.ts";
import { buildSessionConfig } from "./live.ts";

const E164 = /^\+[1-9]\d{6,14}$/;
const HEADER = "x-assist";

// Marker im SIP-Header: ohne ihn koennte jeder, der die Projekt-ID kennt, die SIP-Adresse anrufen
const marker = (secret: string) => createHmac("sha256", secret).update("sip-call").digest("hex").slice(0, 32);

export function callRoutes(config: Config): Hono {
  const app = new Hono();
  const p = config.phone;
  app.post("/api/call", async (c) => {
    if (!p) return c.json({ error: "phone_not_configured" }, 501);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.number !== "string" || !E164.test(body.number)) return c.json({ error: "invalid_number" }, 400);
    const twiml = `<Response><Dial><Sip>sip:${p.openaiProjectId}@sip.api.openai.com;transport=tls?${HEADER}=${marker(config.sessionSecret)}</Sip></Dial></Response>`;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${p.twilioSid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${p.twilioSid}:${p.twilioToken}`)}` },
      body: new URLSearchParams({ To: body.number, From: p.twilioFrom, Twiml: twiml }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) {
      console.error("twilio call failed", res?.status ?? "network");
      return c.json({ error: "call_failed" }, 502);
    }
    return c.body(null, 204);
  });

  app.post("/webhooks/openai", async (c) => {
    if (!p) return c.body(null, 404);
    const client = new OpenAI({ apiKey: config.openaiApiKey, webhookSecret: p.webhookSecret });
    const event = await client.webhooks.unwrap(await c.req.text(), c.req.raw.headers).catch(() => null);
    if (!event) return c.body(null, 400);
    if (event.type !== "live.transport.incoming") return c.body(null, 204);
    const { session_id, sip_headers } = event.data;
    const ours = sip_headers.some((h) => h.name.toLowerCase() === HEADER && h.value === marker(config.sessionSecret));
    try {
      if (!ours) await client.live.sessions.reject(session_id, { status_code: 603 });
      else {
        // shortcut: am Telefon laufen keine HA-Tools, weil deren Function-Calls sonst der Browser ausfuehrt; Sideband-WS zum Upgrade
        const s = buildSessionConfig(config) as any;
        s.delegation.responses.tools = s.delegation.responses.tools.filter((t: any) => t.type !== "function");
        await client.live.sessions.accept(session_id, { session: { ...s, type: "live" } });
      }
    } catch (e) {
      console.error("live call accept failed", (e as { status?: number })?.status ?? "");
      return c.body(null, 502);
    }
    return c.body(null, 204);
  });
  return app;
}
