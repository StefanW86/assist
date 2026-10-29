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

const NEGATIVE = ["nein", "nicht", "kein", "stopp", "warte", "doch nicht", "abbrechen"];
const POSITIVE = ["ja", "jawohl", "okay", "ok", "bestätigt", "bestätige", "mach", "los", "genau"];

// Whole-word / whole-phrase match on normalized text.
function hasWord(padded: string, words: string[]): boolean {
  return words.some((w) => padded.includes(` ${w} `));
}

export function isAffirmative(text: string): boolean {
  if (text.trim().endsWith("?")) return false;
  const padded = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return !hasWord(padded, NEGATIVE) && hasWord(padded, POSITIVE);
}

export class ConfirmationStore {
  #now: () => number;
  #seq = 0; // ordering independent of clock resolution
  #pending = new Map<string, { action: PendingAction; createdAt: number; seq: number }>();
  #last: { text: string; seq: number } | undefined;

  constructor(now: () => number) {
    this.#now = now;
  }

  create(action: PendingAction): string {
    const id = randomUUID();
    this.#pending.set(id, { action, createdAt: this.#now(), seq: ++this.#seq });
    return id;
  }

  addUtterance(text: string): void {
    this.#last = { text, seq: ++this.#seq };
  }

  take(id: string): PendingAction | { error: "unknown" | "expired" | "not_confirmed" } {
    const p = this.#pending.get(id);
    if (!p) return { error: "unknown" };
    if (this.#now() - p.createdAt > TTL_MS) {
      this.#pending.delete(id);
      return { error: "expired" };
    }
    if (!this.#last || this.#last.seq < p.seq || !isAffirmative(this.#last.text)) {
      return { error: "not_confirmed" };
    }
    this.#pending.delete(id);
    return p.action;
  }
}
