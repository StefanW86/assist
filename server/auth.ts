import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Config } from "./config.ts";

const COOKIE = "assist_session";
const MAX_AGE = 30 * 24 * 3600;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sha = (s: string) => createHash("sha256").update(s).digest();

async function validSession(c: Parameters<MiddlewareHandler>[0], config: Config, now: () => number) {
  const v = await getSignedCookie(c, config.sessionSecret, COOKIE);
  return typeof v === "string" && Number(v) > now();
}

export function authRoutes(config: Config, now: () => number): Hono {
  const app = new Hono();
  // shortcut: in-memory, Eintraege werden nie geraeumt; bei vielen IPs/Mehrinstanz ersetzen
  const attempts = new Map<string, { fails: number; lockedUntil: number }>();

  const clientIp = (c: Parameters<MiddlewareHandler>[0]): string => {
    const h = c.req.header("CF-Connecting-IP");
    if (h) return h;
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    const body = await c.req.json().catch(() => null);
    const pw = typeof body?.password === "string" ? body.password : "";
    // kein await ab hier: get/Sperre/Vergleich/Zaehler muessen atomar sein (parallele Requests)
    const rec = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
    if (rec.lockedUntil > now()) return c.body(null, 429);
    if (rec.lockedUntil) {
      rec.fails = 0;
      rec.lockedUntil = 0;
    }
    if (!timingSafeEqual(sha(pw), sha(config.appPassword))) {
      rec.fails++;
      if (rec.fails >= MAX_FAILS) rec.lockedUntil = now() + LOCK_MS;
      attempts.set(ip, rec);
      return c.body(null, 401);
    }
    attempts.delete(ip);
    await setSignedCookie(c, COOKIE, String(now() + MAX_AGE * 1000), config.sessionSecret, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: MAX_AGE,
      path: "/",
    });
    return c.body(null, 204);
  });

  app.get("/me", async (c) => ((await validSession(c, config, now)) ? c.body(null, 204) : c.body(null, 401)));

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  return app;
}

export function requireAuth(config: Config, now: () => number = Date.now, exempt: string[] = []): MiddlewareHandler {
  return async (c, next) => {
    if (!exempt.includes(c.req.path) && !(await validSession(c, config, now))) return c.body(null, 401);
    await next();
  };
}
