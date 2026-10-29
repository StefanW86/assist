// Event-Namen laut https://developers.openai.com/api/docs/guides/live-delegation
// und https://developers.openai.com/api/docs/guides/live-conversations (geprueft 2026-10-29).
export const DELEGATION_CREATED = "session.delegation.created";
export const RESPONSE_EVENT = "response.event"; // Umschlag, inneres Event in `event`
export const OUTPUT_ITEM_DONE = "response.output_item.done"; // item: { type: "function_call", name, arguments, call_id }
export const BACKEND_STARTED = "response.created";
// Doku nennt kein eigenes "Delegation fertig"-Event; das Backend-Response-Ende ist das Signal.
export const BACKEND_DONE = ["response.completed", "response.failed", "response.incomplete", "response.cancelled"];
export const INPUT_TRANSCRIPT_DELTA = "session.input_transcript.delta";
export const OUTPUT_TRANSCRIPT_DELTA = "session.output_transcript.delta";
export const SESSION_CLOSED = "session.closed";

// Fester Satz: ein vom Modell gewaehlter Name wie "../transcript" darf nie zu einem anderen Endpunkt werden.
const TOOLS = new Set(["ha_search", "ha_get_state", "ha_call_service", "confirm_action"]);

export function createDelegationHandler(
  send: (msg: object) => void,
  callTool: (name: string, args: unknown) => Promise<unknown>,
  onWorking: (active: boolean) => void,
): (event: any) => Promise<void> {
  let open = 0;
  let backend = false;
  let resumes = 0; // gesendete response.create ohne zugehoeriges response.created
  const settle = () => {
    if (open === 0 && resumes === 0 && !backend) onWorking(false);
  };

  async function run(item: any): Promise<unknown> {
    if (!TOOLS.has(item.name)) return { error: "unknown_tool" };
    let args: unknown;
    try {
      args = JSON.parse(item.arguments);
    } catch {
      return { error: "invalid_arguments" };
    }
    try {
      return await callTool(item.name, args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return async (event) => {
    if (event?.type === DELEGATION_CREATED) {
      backend = true;
      onWorking(true);
      return;
    }
    if (event?.type !== RESPONSE_EVENT) return;
    const inner = event.event;
    if (inner?.type === BACKEND_STARTED) {
      backend = true;
      resumes = Math.max(0, resumes - 1);
    }
    if (BACKEND_DONE.includes(inner?.type)) {
      backend = false;
      settle();
    }
    const item = inner?.item;
    if (inner?.type !== OUTPUT_ITEM_DONE || item?.type !== "function_call") return;
    open++;
    try {
      const result = await run(item);
      send({ type: "response.item.create", item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result) } });
      send({ type: "response.create" });
      resumes++;
    } finally {
      open--;
      settle();
    }
  };
}

// Die Doku kennt kein "Transkript final"-Event (nur Deltas ohne Item-ID): eine Aeusserung gilt als
// abgeschlossen, sobald eines der `ends`-Events kommt oder end() aufgerufen wird.
export function createTranscript(delta: string, ends: string[], onText: (text: string, final: boolean) => void) {
  let text = "";
  const end = () => {
    const t = text.trim();
    text = "";
    if (t) onText(t, true);
  };
  return {
    handle(event: any) {
      if (event?.type === delta && typeof event.delta === "string") {
        text += event.delta;
        onText(text, false);
      } else if (ends.includes(event?.type)) end();
    },
    end,
  };
}
