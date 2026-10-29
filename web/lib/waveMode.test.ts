import { expect, test } from "vitest";
import { pickMode } from "./waveMode.ts";

test("pickMode: Assistent vor Nutzer vor Arbeiten vor Ruhe", () => {
  expect(pickMode(0.5, 0.5, true, 0.02)).toBe("assistant");
  expect(pickMode(0.5, 0.01, true, 0.02)).toBe("user");
  expect(pickMode(0.01, 0.01, true, 0.02)).toBe("working");
  expect(pickMode(0.02, 0.02, false, 0.02)).toBe("idle"); // Schwelle selbst zählt noch als still
});
