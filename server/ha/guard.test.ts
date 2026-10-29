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
  it.each(["nein", "ja, nein doch nicht", "nicht aufschließen", "warte", "", "ja?", "nichts", "jaja nein", "Ja? Okay", "Ist das okay? ja", "ist das okay", "ja stop", "nee ok", "nö okay", "soll ich das machen", "Ja?!"])(
    "rejects %j",
    (t) => {
      expect(isAffirmative(t)).toBe(false);
    },
  );
  it("only short utterances count (max 4 words)", () => {
    expect(isAffirmative("Mach lieber das Licht im Flur an")).toBe(false);
    expect(isAffirmative("ja mach das bitte")).toBe(true);
    expect(isAffirmative("ja mach das bitte jetzt")).toBe(false);
  });
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
    const { store, advance } = setup();
    const id = store.create(action);
    advance(1500);
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
  it("consent must come >= 1500 ms after create", () => {
    const { store, advance } = setup();
    const id = store.create(action);
    advance(1000);
    store.addUtterance("ja");
    expect(store.take(id)).toEqual({ error: "not_confirmed" });
    advance(600);
    store.addUtterance("ja");
    expect(store.take(id)).toEqual(action);
  });
  it("a 'nein' rejects all pending actions, a later 'ja' does not confirm them", () => {
    const { store, advance } = setup();
    const id = store.create(action);
    advance(2000);
    store.addUtterance("nein");
    store.addUtterance("ja");
    expect(store.take(id)).toEqual({ error: "not_confirmed" });
    expect(store.take(id)).toEqual({ error: "unknown" });
  });
  it("a successful take clears the other pending actions", () => {
    const { store, advance } = setup();
    const a = store.create(action);
    const b = store.create({ ...action, entity_id: "lock.keller" });
    advance(2000);
    store.addUtterance("ja");
    expect(store.take(a)).toEqual(action);
    expect(store.take(b)).toEqual({ error: "unknown" });
  });
  it("unknown id", () => {
    expect(setup().store.take("x")).toEqual({ error: "unknown" });
  });
});
