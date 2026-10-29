// OpenAI Live (gpt-live-1), geprueft am 2026-10-29:
// - https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
// - https://developers.openai.com/api/docs/guides/live-prompting
// - https://developers.openai.com/api/docs/guides/live-delegation
// - https://developers.openai.com/api/docs/models/gpt-live-1
// Befund:
// - Installiertes openai-SDK (7.45.1) hat client.live.create({ session, transport: { type: "webrtc", sdp } })
//   -> POST /v1/live/sessions, Antwort { session: { id }, transport: { type: "webrtc", sdp } } (HTTP 201).
// - Prompt-Feld: session.instructions (Frontend). Backend-Prompt: session.delegation.responses.instructions.
// - Stimme: session.audio.output.voice (Default "marin", nach Start unveraenderlich) - hier nicht gesetzt.
// - Kein Sprachfeld; Sprache wird im Prompt festgelegt. audio.format bei WebRTC weglassen.
// - Delegation: { type: "responses", responses: { model, instructions, tools, tool_choice } };
//   Web-Suche: { type: "web_search" }; Function-Tools: { type: "function", name, description, parameters }.
// - Function-Calls fuehrt die Anwendung aus: Der Browser bekommt response.event-Umschlaege
//   (response.output_item.done), sendet response.item.create (function_call_output) und dann response.create.
import OpenAI from "openai";
import type { Config } from "./config.ts";
import { BACKEND_PROMPT, HA_TOOL_DEFS, VOICE_PROMPT } from "./prompt.ts";

export interface LiveClient {
  create(session: object, sdp: string): Promise<{ id: string; sdp: string }>;
}

export function buildSessionConfig(config: Config): object {
  return {
    model: "gpt-live-1",
    instructions: VOICE_PROMPT,
    delegation: {
      type: "responses",
      responses: {
        model: config.liveBackendModel,
        instructions: BACKEND_PROMPT,
        tools: [{ type: "web_search" }, ...HA_TOOL_DEFS],
        tool_choice: "auto",
      },
    },
  };
}

export function createLiveClient(apiKey: string): LiveClient {
  const client = new OpenAI({ apiKey });
  return {
    async create(session, sdp) {
      const res = await client.live.create({ session: session as never, transport: { type: "webrtc", sdp } });
      return { id: res.session.id, sdp: res.transport.sdp };
    },
  };
}
