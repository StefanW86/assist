export type WaveMode = "idle" | "user" | "assistant" | "working";

// Pegel als RMS (0..1). Der Assistent hat Vorrang, damit Echo-Reste des Mikrofons nicht die Farbe kippen.
export function pickMode(micLevel: number, remoteLevel: number, working: boolean, threshold: number): WaveMode {
  if (remoteLevel > threshold) return "assistant";
  if (micLevel > threshold) return "user";
  return working ? "working" : "idle";
}
