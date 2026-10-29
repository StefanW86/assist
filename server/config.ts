export type Config = {
  openaiApiKey: string;
  appPassword: string;
  sessionSecret: string;
  haMcpUrl: string;
  haToken?: string;
  haConfirmEntities: string[];
  haEntityAllowlist: string[] | null;
  liveBackendModel: string;
  phone?: { twilioSid: string; twilioToken: string; twilioFrom: string; openaiProjectId: string; webhookSecret: string };
  port: number;
};

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function loadConfig(env: Record<string, string | undefined>): Config {
  const req = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Umgebungsvariable ${name} fehlt`);
    return v;
  };
  if (req("SESSION_SECRET").length < 32) throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein");
  const allow = list(env.HA_ENTITY_ALLOWLIST);
  return {
    openaiApiKey: req("OPENAI_API_KEY"),
    appPassword: req("APP_PASSWORD"),
    sessionSecret: req("SESSION_SECRET"),
    haMcpUrl: req("HA_MCP_URL"),
    haToken: env.HA_TOKEN || undefined,
    haConfirmEntities: list(env.HA_CONFIRM_ENTITIES),
    haEntityAllowlist: allow.length ? allow : null,
    liveBackendModel: env.LIVE_BACKEND_MODEL || "gpt-6-luna",
    // Telefonie nur, wenn alles gesetzt ist; sonst antwortet /api/call mit 501
    phone: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && env.OPENAI_PROJECT_ID && env.OPENAI_WEBHOOK_SECRET
      ? { twilioSid: env.TWILIO_ACCOUNT_SID, twilioToken: env.TWILIO_AUTH_TOKEN, twilioFrom: env.TWILIO_FROM, openaiProjectId: env.OPENAI_PROJECT_ID, webhookSecret: env.OPENAI_WEBHOOK_SECRET }
      : undefined,
    port: env.PORT ? Number(env.PORT) : 8080,
  };
}
