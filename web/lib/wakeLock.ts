let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export async function acquire(): Promise<void> {
  wanted = true;
  try {
    const s = (await navigator.wakeLock?.request("screen")) ?? null;
    if (wanted) sentinel = s;
    else s?.release();
  } catch {
    // z. B. Energiesparmodus oder kein HTTPS – das Gespräch läuft trotzdem
  }
}

export function release(): void {
  wanted = false;
  sentinel?.release().catch(() => {});
  sentinel = null;
}

// Der Browser gibt die Sperre beim Verstecken der Seite frei; beim Zurückkehren neu anfordern.
document.addEventListener("visibilitychange", () => {
  if (wanted && document.visibilityState === "visible") void acquire();
});
