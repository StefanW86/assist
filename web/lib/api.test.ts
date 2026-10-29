import { afterEach, describe, expect, it, vi } from "vitest";
import { login, me, postJson, UnauthorizedError } from "./api.ts";

const stub = (status: number, body?: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe("login", () => {
  it.each([[204, "ok"], [401, "wrong"], [429, "locked"]] as const)("%i -> %s", async (status, out) => {
    stub(status);
    expect(await login("pw")).toBe(out);
  });
  it("sends password as JSON with same-origin credentials", async () => {
    stub(204);
    await login("pw");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/login");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: JSON.stringify({ password: "pw" }) });
  });
});

describe("me", () => {
  it("true on 204, false on 401", async () => {
    stub(204);
    expect(await me()).toBe(true);
    stub(401);
    expect(await me()).toBe(false);
  });
});

describe("postJson", () => {
  it("throws UnauthorizedError on 401", async () => {
    stub(401);
    await expect(postJson("/api/x", {})).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it("returns parsed JSON", async () => {
    stub(200, { a: 1 });
    expect(await postJson("/api/x", { b: 2 })).toEqual({ a: 1 });
  });
  it("throws on other errors", async () => {
    stub(500);
    await expect(postJson("/api/x", {})).rejects.toThrow("500");
  });
});
