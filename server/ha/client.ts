import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface HaClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createHaClient(url: string, token?: string): HaClient {
  let conn: Promise<Client> | undefined;
  const connect = async () => {
    const client = new Client({ name: "assist", version: "0.0.1" });
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    return client;
  };

  return {
    async callTool(name, args) {
      const current = (conn ??= connect());
      let res;
      try {
        res = await (await current).callTool({ name, arguments: args });
      } catch (e) {
        // drop the broken connection so the next call reconnects
        if (conn === current) conn = undefined;
        current.then((c) => c.close()).catch(() => {});
        throw e;
      }
      const content = (res.content ?? []) as { type: string; text?: string }[];
      const text = content.filter((p) => p.type === "text").map((p) => p.text).join("");
      if (res.isError) throw new Error(text || "ha_error");
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}
