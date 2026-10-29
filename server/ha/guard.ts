import { randomUUID } from "node:crypto";

export type PendingAction = {
  domain: string;
  service: string;
  entity_id: string;
  data?: Record<string, unknown>;
  description: string;
};

const TTL_MS = 60_000;

export function needsConfirmation(
  entity: { entity_id: string; attributes?: { device_class?: string } },
  confirmEntities: string[],
): boolean {
  const domain = entity.entity_id.split(".")[0];
  const dc = entity.attributes?.device_class;
  return (
    domain === "lock" ||
    domain === "alarm_control_panel" ||
    (domain === "cover" && (dc === "garage" || dc === "gate")) ||
    confirmEntities.includes(entity.entity_id)
  );
}

// "doch nicht" is covered by "nicht".
const NEGATIVE = [
  "nein", "nee", "nö", "no", "nicht", "nie", "niemals", "kein", "keine", "keinen",
  "stopp", "stop", "warte", "halt", "moment", "vergiss", "lass", "abbrechen",
];
// STT often drops "?", so a leading question word also rejects.
const QUESTION_START = ["ist", "soll", "sollst", "darf", "warum", "wieso", "was", "wer", "wie", "kannst", "bist"];
const POSITIVE = ["ja", "jawohl", "okay", "ok", "bestätigt", "bestätige", "mach", "los", "genau"];

// shortcut: "mach zu" also counts as consent; upgrade = match consent against the pending action.
// Whole-word / whole-phrase match on normalized text.
function hasWord(padded: string, words: string[]): boolean {
  return words.some((w) => padded.includes(` ${w} `));
}

const MAX_WORDS = 4; // longer sentences are new requests, not consent
const MIN_DELAY_MS = 1500; // late transcript fragments of the triggering sentence must not count

export function isAffirmative(text: string): boolean {
  if (text.includes("?")) return false;
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = norm.split(" ");
  if (words.length > MAX_WORDS || QUESTION_START.includes(words[0])) return false;
  const padded = ` ${norm} `;
  return !hasWord(padded, NEGATIVE) && hasWord(padded, POSITIVE);
}

export class ConfirmationStore {
  #now: () => number;
  #pending = new Map<string, { action: PendingAction; createdAt: number; rejected: boolean }>();
  #last: { text: string; at: number } | undefined;

  constructor(now: () => number) {
    this.#now = now;
  }

  create(action: PendingAction): string {
    const id = randomUUID();
    this.#pending.set(id, { action, createdAt: this.#now(), rejected: false });
    return id;
  }

  addUtterance(text: string): void {
    this.#last = { text, at: this.#now() };
    // fail closed: anything but consent (e.g. "nein") rejects every open question for good
    if (!isAffirmative(text)) for (const p of this.#pending.values()) p.rejected = true;
  }

  take(id: string): PendingAction | { error: "unknown" | "expired" | "not_confirmed" } {
    const p = this.#pending.get(id);
    if (!p) return { error: "unknown" };
    if (this.#now() - p.createdAt > TTL_MS) {
      this.#pending.delete(id);
      return { error: "expired" };
    }
    if (p.rejected) {
      this.#pending.delete(id);
      return { error: "not_confirmed" };
    }
    if (!this.#last || this.#last.at - p.createdAt < MIN_DELAY_MS || !isAffirmative(this.#last.text)) {
      return { error: "not_confirmed" };
    }
    this.#pending.clear(); // one "ja" confirms one action
    return p.action;
  }
}
