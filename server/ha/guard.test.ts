import { describe, expect, it } from "vitest";
import { ConfirmationStore, isAffirmative, needsConfirmation } from "./guard.ts";

describe("needsConfirmation", () => {
  it("flags dangerous entities", () => {
    expect(needsConfirmation({ entity_id: "lock.haustuer" }, [])).toBe(true);
    expect(needsConfirmation({ entity_id: "alarm_control_panel.home" }, [])).toBe(true);
    expect(needsConfirmation({ entity_id: "cover.tor", attributes: { device_class: "garage" } }, [])).toBe(true);
    expect(needsConfirmation({ entity_id: "cover.tor", attributes: { device_class: "gate" } }, [])).toBe(true);
    expect(needsConfirmation({ entity_id: "switch.garage" }, ["switch.garage"])).toBe(true);
  });
  it("lets harmless entities pass", () => {
    expect(needsConfirmation({ entity_id: "cover.tor", attributes: { device_class: "blind" } }, [])).toBe(false);
    expect(needsConfirmation({ entity_id: "light.wohnzimmer" }, [])).toBe(false);
    expect(needsConfirmation({ entity_id: "switch.garage" }, [])).toBe(false);
  });
});

describe("isAffirmative", () => {
  it.each(["Ja", "ja bitte", "Ja, mach das", "bestätigt", "mach auf", "okay"])("accepts %j", (t) => {
    expect(isAffirmative(t)).toBe(true);
  });
  it.each(["nein", "ja, nein doch nicht", "nicht aufschließen", "warte", "", "ja?", "nichts", "jaja nein"])(
    "rejects %j",
    (t) => {
      expect(isAffirmative(t)).toBe(false);
    },
  );
  it("matches whole words only", () => {
    expect(isAffirmative("jahr")).toBe(false);
    expect(isAffirmative("losgehts")).toBe(false);
  });
});

describe("ConfirmationStore", () => {
  const action = { domain: "lock", service: "unlock", entity_id: "lock.haustuer", description: "Haustür aufschließen" };
  const setup = () => {
    let t = 1000;
    const store = new ConfirmationStore(() => t);
    return { store, advance: (ms: number) => (t += ms) };
  };

  it("needs an utterance", () => {
    const { store } = setup();
    expect(store.take(store.create(action))).toEqual({ error: "not_confirmed" });
  });
  it("ignores utterances from before create", () => {
    const { store } = setup();
    store.addUtterance("ja");
    expect(store.take(store.create(action))).toEqual({ error: "not_confirmed" });
  });
  it("returns the action once", () => {
    const { store } = setup();
    const id = store.create(action);
    store.addUtterance("ja");
    expect(store.take(id)).toEqual(action);
    expect(store.take(id)).toEqual({ error: "unknown" });
  });
  it("expires after 60s", () => {
    const { store, advance } = setup();
    const id = store.create(action);
    store.addUtterance("ja");
    advance(61_000);
    expect(store.take(id)).toEqual({ error: "expired" });
  });
  it("last utterance decides", () => {
    const { store } = setup();
    const id = store.create(action);
    store.addUtterance("ja");
    store.addUtterance("nein");
    expect(store.take(id)).toEqual({ error: "not_confirmed" });
  });
  it("unknown id", () => {
    expect(setup().store.take("x")).toEqual({ error: "unknown" });
  });
});
