import { describe, expect, it, vi } from "vitest";
import { createDelegationHandler, createTranscript } from "./delegation.ts";

const call = (name: string, args: string, call_id = "c1") => ({
  type: "response.event",
  delegation_id: "d1",
  event: { type: "response.output_item.done", item: { type: "function_call", name, arguments: args, call_id } },
});

function setup(callTool: (name: string, args: any) => Promise<unknown> = vi.fn(async () => ({ ok: true }))) {
  const send = vi.fn();
  const onWorking = vi.fn();
  return { send, callTool, onWorking, handle: createDelegationHandler(send, callTool, onWorking) };
}

const output = (send: ReturnType<typeof vi.fn>) => JSON.parse(send.mock.calls[0]![0].item.output);

describe("createDelegationHandler", () => {
  it("runs the function call, returns its output and resumes the backend", async () => {
    const t = setup();
    await t.handle(call("ha_get_state", '{"entity_id":"light.a"}'));
    expect(t.callTool).toHaveBeenCalledWith("ha_get_state", { entity_id: "light.a" });
    expect(t.send.mock.calls.map((c) => c[0])).toEqual([
      { type: "response.item.create", item: { type: "function_call_output", call_id: "c1", output: '{"ok":true}' } },
      { type: "response.create" },
    ]);
  });

  it("invalid arguments -> no callTool, error output and response.create", async () => {
    const t = setup();
    await t.handle(call("ha_get_state", "{kaputt"));
    expect(t.callTool).not.toHaveBeenCalled();
    expect(output(t.send)).toEqual({ error: "invalid_arguments" });
    expect(t.send.mock.calls[1]![0]).toEqual({ type: "response.create" });
  });

  it("callTool throws -> error output", async () => {
    const t = setup(vi.fn(async () => { throw new Error("boom"); }));
    await t.handle(call("ha_search", '{"query":"x"}'));
    expect(output(t.send)).toEqual({ error: "boom" });
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it.each(["../transcript", "transcript", "toString", "__proto__"])("unknown tool %s -> no callTool, unknown_tool", async (name) => {
    const t = setup();
    await t.handle(call(name, "{}"));
    expect(t.callTool).not.toHaveBeenCalled();
    expect(output(t.send)).toEqual({ error: "unknown_tool" });
    expect(t.send.mock.calls[1]![0]).toEqual({ type: "response.create" });
  });

  it("overlapping calls: both outputs, then exactly one response.create; working ends", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    const t = setup(vi.fn((_name: string, args: any) => new Promise((r) => (pending[args.id] = r))));
    const nested = (type: string) => ({ type: "response.event", event: { type } });
    await t.handle({ type: "session.delegation.created" });
    const a = t.handle(call("ha_get_state", '{"id":"a"}', "c1"));
    const b = t.handle(call("ha_get_state", '{"id":"b"}', "c2"));
    await t.handle(nested("response.completed"));
    pending.b!(2);
    await b;
    pending.a!(1);
    await a;
    expect(t.send.mock.calls.map((c) => c[0].item?.call_id ?? c[0].type)).toEqual(["c2", "c1", "response.create"]);
    expect(t.onWorking).not.toHaveBeenCalledWith(false);
    await t.handle(nested("response.created"));
    await t.handle(nested("response.completed"));
    expect(t.onWorking).toHaveBeenLastCalledWith(false);
  });

  it("undefined result -> output null; unsent response.create is not awaited", async () => {
    const t = setup(vi.fn(async () => undefined));
    t.send.mockReturnValue(false); // Datenkanal zu
    await t.handle({ type: "session.delegation.created" });
    await t.handle(call("ha_search", "{}"));
    expect(t.send.mock.calls[0]![0].item.output).toBe("null");
    await t.handle({ type: "response.event", event: { type: "response.completed" } });
    expect(t.onWorking).toHaveBeenLastCalledWith(false);
  });

  it("ignores other events", async () => {
    const t = setup();
    for (const e of [
      { type: "session.input_transcript.delta", delta: "hi" },
      { type: "response.event", event: { type: "response.output_text.delta", delta: "x" } },
      { type: "response.event", event: { type: "response.output_item.done", item: { type: "message" } } },
      { type: "response.output_item.done", item: { type: "function_call", name: "ha_search", arguments: "{}", call_id: "c" } },
      null,
    ]) await t.handle(e);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.callTool).not.toHaveBeenCalled();
  });

  it("working until no call is open and the backend has completed", async () => {
    const t = setup();
    const nested = (type: string) => ({ type: "response.event", event: { type } });
    await t.handle({ type: "session.delegation.created", delegation: { id: "d1", target: "responses" } });
    expect(t.onWorking).toHaveBeenLastCalledWith(true);
    await t.handle(nested("response.created"));
    await t.handle(call("ha_search", "{}"));
    await t.handle(nested("response.completed")); // first backend response ends after the function call
    expect(t.onWorking).not.toHaveBeenCalledWith(false); // resumed via response.create, still working
    await t.handle(nested("response.created"));
    await t.handle(nested("response.completed"));
    expect(t.onWorking).toHaveBeenLastCalledWith(false);
  });
});

describe("createTranscript", () => {
  it("accumulates deltas and emits final text on an end event", () => {
    const onText = vi.fn();
    const tr = createTranscript("session.input_transcript.delta", ["session.delegation.created"], onText);
    tr.handle({ type: "session.input_transcript.delta", delta: "Licht " });
    tr.handle({ type: "session.input_transcript.delta", delta: "an" });
    tr.handle({ type: "session.output_transcript.delta", delta: "nope" });
    tr.handle({ type: "session.delegation.created" });
    tr.handle({ type: "session.delegation.created" });
    expect(onText.mock.calls).toEqual([["Licht ", false], ["Licht an", false], ["Licht an", true]]);
  });

  it("end() flushes pending text once", () => {
    const onText = vi.fn();
    const tr = createTranscript("d", [], onText);
    tr.end();
    tr.handle({ type: "d", delta: " Ja " });
    tr.end();
    tr.end();
    expect(onText.mock.calls).toEqual([[" Ja ", false], ["Ja", true]]);
  });
});
