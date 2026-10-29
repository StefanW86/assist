export class UnauthorizedError extends Error {
  constructor() {
    super("Nicht angemeldet");
  }
}

const call = (path: string, method: string, body?: unknown) =>
  fetch(path, {
    method,
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000), // ein haengender POST darf keine Tool-Aufrufe blockieren
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

export async function login(password: string): Promise<"ok" | "wrong" | "locked"> {
  const res = await call("/api/login", "POST", { password });
  if (res.status === 204) return "ok";
  if (res.status === 429) return "locked";
  if (res.status === 401) return "wrong";
  throw new Error(`Login fehlgeschlagen (${res.status})`);
}

export async function me(): Promise<boolean> {
  return (await call("/api/me", "GET")).status === 204;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await call(path, "POST", body);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Anfrage fehlgeschlagen (${res.status})`);
  if (res.status === 204) return undefined as T; // z. B. /api/transcript: kein Body, res.json() wuerde werfen
  return (await res.json()) as T;
}
