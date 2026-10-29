# Voice-Assistant PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handy-taugliche Webapp, in der man per Mikrofonbutton ein Full-Duplex-Gespräch mit `gpt-live-1` führt, das Wetter per Websuche und Home Assistant (lesen + schalten) über einen eigenen Node-Server nutzt – kennwortgeschützt, als Docker-Container.

**Architecture:** Ein Node-Prozess (Hono) liefert die gebaute React-App und `/api/*` aus. Der Browser verbindet sich per WebRTC mit der OpenAI Live API; der Server tauscht nur das SDP aus und hält alle Secrets. Backend-Arbeit läuft über `delegation.type: "responses"`; Home-Assistant-Funktionsaufrufe kommen im Browser-Datenkanal an, werden an `/api/tools/:name` weitergereicht und dort über `ha-mcp` (Streamable HTTP) im Heimnetz ausgeführt.

**Tech Stack:** Node 26 LTS (Container) / ≥24 lokal, TypeScript (Server per Node-Type-Stripping, kein Build), Hono + @hono/node-server, `openai` SDK, `@modelcontextprotocol/sdk`, React 19 + Vite, Tailwind CSS v4, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-voice-assistant-poc-design.md`

## Global Constraints

- Sprachmodell `gpt-live-1`, nur über `POST /v1/live/sessions`, Transport `webrtc`, Datenkanal-Label `oai-events` (vor dem SDP-Offer anlegen). Kein `session.start` senden.
- Delegation: `delegation.type: "responses"`, Backend-Modell aus `LIVE_BACKEND_MODEL`, Default `gpt-6-luna`.
- `OPENAI_API_KEY`, `HA_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET` verlassen nie den Server (nicht im Bundle, nicht an OpenAI, nicht in Logs).
- Env-Variablen exakt: `OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `HA_MCP_URL`, `HA_TOKEN` (optional), `HA_CONFIRM_ENTITIES`, `HA_ENTITY_ALLOWLIST`, `LIVE_BACKEND_MODEL`, `PORT` (Default `8080`).
- Login: Cookie signiert, `httpOnly`, `secure`, `sameSite=Strict`, 30 Tage; 5 Fehlversuche → 15 Min Sperre pro IP aus `CF-Connecting-IP` (Fallback: Socket-Adresse).
- Bestätigungspflichtig: Domains `lock`, `alarm_control_panel`; `cover` mit `device_class` `garage` oder `gate`; jede Entität in `HA_CONFIRM_ENTITIES`. Ausstehende Aktion verfällt nach 60 s.
- Alle UI-Texte und der Assistenten-Prompt auf Deutsch.
- Design: dunkelblau, futuristisch, Variante „Wellenform“, mobile-first (Hochformat). Referenz: `.superpowers/brainstorm/1342-1793271467/content/hauptscreen.html` (Karte C).
- Docker-Image auf Basis `ubuntu:24.04`, läuft als Non-Root, ein Port.
- Server-TypeScript nur mit „erasable syntax“ (keine `enum`, keine Parameter-Properties), damit `node server/index.ts` direkt läuft; Imports mit `.ts`-Endung.

## Review Focus

- Verneinte oder gemischte Zustimmung („nein“, „ja, nein doch nicht“, „nicht aufschließen“) darf eine ausstehende Aktion **nicht** ausführen → Test in Task 3.
- Zustimmung, die vor dem Anlegen der Aktion gesagt wurde oder nach 60 s kommt, wird abgelehnt → Test in Task 3.
- Funktionsaufruf auf eine Entität außerhalb der Allowlist (wenn gesetzt) liefert Fehler und ruft keinen Dienst auf → Test in Task 4.
- `ha-mcp` nicht erreichbar oder Fehler → Tool-Endpunkt antwortet `200` mit `{ "error": "..." }`, damit der Assistent es sagen kann; Server stürzt nicht ab → Test in Task 4.
- Kaputte `arguments` (kein JSON) im Funktionsaufruf → Browser sendet ein `function_call_output` mit Fehler statt hängen zu bleiben → Test in Task 7.

---

### Task 1: Projektgerüst, Config, Git

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `server/config.ts`
- Test: `server/config.test.ts`

**Interfaces:**
- Produces: `type Config = { openaiApiKey: string; appPassword: string; sessionSecret: string; haMcpUrl: string; haToken?: string; haConfirmEntities: string[]; haEntityAllowlist: string[] | null; liveBackendModel: string; port: number }` und `loadConfig(env: Record<string, string | undefined>): Config`.

- [ ] **Step 1:** `git init`; `.gitignore` mit `node_modules`, `dist`, `.env`, `.superpowers/`. Ein `package.json` (type `module`, `engines.node >=24`) für Server und Web gemeinsam; Scripts: `dev:server` (`node --watch server/index.ts`), `dev:web` (`vite`), `build` (`vite build`), `start` (`node server/index.ts`), `test` (`vitest run`). Abhängigkeiten installieren: `hono @hono/node-server openai @modelcontextprotocol/sdk zod`, dev: `typescript vitest @types/node`.
- [ ] **Step 2: Failing tests** in `server/config.test.ts`:
  - `loadConfig` wirft, wenn `OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET` oder `HA_MCP_URL` fehlt (Fehlermeldung nennt den Namen).
  - Defaults: `liveBackendModel === "gpt-6-luna"`, `port === 8080`, `haConfirmEntities` = `[]`, `haEntityAllowlist === null`.
  - `HA_CONFIRM_ENTITIES=" switch.garage , lock.x"` → `["switch.garage", "lock.x"]`; `HA_ENTITY_ALLOWLIST=""` → `null`.
- [ ] **Step 3:** `npm test` → FAIL.
- [ ] **Step 4:** `loadConfig` implementieren. `.env.example` mit allen Variablen aus Global Constraints und Kommentar je Zeile.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6:** Commit `chore: scaffold project and config` (inkl. Spec und Plan unter `docs/`).

### Task 2: Login und Auth-Middleware

**Files:**
- Create: `server/auth.ts`, `server/app.ts`
- Test: `server/auth.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces: `createApp(deps: AppDeps): Hono` in `server/app.ts` mit `type AppDeps = { config: Config; live: LiveClient; ha: HaClient; now?: () => number }` (`LiveClient` aus Task 5, `HaClient` aus Task 4 – bis dahin als `unknown`-Platzhalter-Typ deklarieren und später ersetzen). In `server/auth.ts`: `authRoutes(config, now): Hono` (montiert unter `/api`), `requireAuth(config): MiddlewareHandler`. Endpunkte: `POST /api/login` Body `{ password: string }` → `204` + Cookie `assist_session` | `401` | `429`; `GET /api/me` → `204` | `401`; `POST /api/logout` → `204`.

- [ ] **Step 1: Failing tests** (über `app.request()`):
  - falsches Kennwort → `401`; richtiges → `204` und `Set-Cookie` enthält `assist_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=2592000`.
  - `GET /api/me` ohne Cookie → `401`, mit Cookie aus Login → `204`; manipuliertes Cookie → `401`.
  - 5 Fehlversuche mit `CF-Connecting-IP: 1.2.3.4` → 6. Versuch (auch mit richtigem Kennwort) `429`; andere IP weiterhin `204`; nach `now() + 15*60*1000` wieder `204`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementieren mit `setSignedCookie`/`getSignedCookie` aus `hono/cookie` (Secret `SESSION_SECRET`, Cookie-Wert z. B. Ablaufzeitstempel, beim Lesen prüfen). Kennwortvergleich: `timingSafeEqual` auf SHA-256 beider Werte. Rate-Limit: In-Memory-`Map<ip, { fails, lockedUntil }>`; erfolgreicher Login setzt den Zähler zurück.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: password login with signed cookie and rate limit`.

### Task 3: Bestätigungslogik (Guard)

**Files:**
- Create: `server/ha/guard.ts`
- Test: `server/ha/guard.test.ts`

**Interfaces:**
- Produces:
  - `needsConfirmation(entity: { entity_id: string; attributes?: { device_class?: string } }, confirmEntities: string[]): boolean`
  - `isAffirmative(text: string): boolean`
  - `class ConfirmationStore` mit `constructor(now: () => number)`, `create(action: PendingAction): string` (gibt ID zurück), `addUtterance(text: string): void`, `take(id: string): PendingAction | { error: "unknown" | "expired" | "not_confirmed" }`.
  - `type PendingAction = { domain: string; service: string; entity_id: string; data?: Record<string, unknown>; description: string }`.

- [ ] **Step 1: Failing tests:**
  - `needsConfirmation`: `lock.haustuer` → true; `alarm_control_panel.home` → true; `cover.tor` mit `device_class: "garage"` → true, mit `"gate"` → true, mit `"blind"` → false; `light.wohnzimmer` → false; `switch.garage` → true, wenn in `confirmEntities`.
  - `isAffirmative`: true für `"Ja"`, `"ja bitte"`, `"Ja, mach das"`, `"bestätigt"`, `"mach auf"`, `"okay"`; false für `"nein"`, `"ja, nein doch nicht"`, `"nicht aufschließen"`, `"warte"`, `""`, `"ja?"` (Frage).
  - `ConfirmationStore`: `take` ohne Äußerung → `not_confirmed`; Äußerung **vor** `create` + keine danach → `not_confirmed`; `"ja"` nach `create` → gibt Aktion zurück; zweites `take` derselben ID → `unknown`; `"ja"` bei `now = created + 61_000` → `expired`; letzte Äußerung nach `create` ist `"nein"` (auch wenn davor `"ja"`) → `not_confirmed`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementieren. `isAffirmative`: Text normalisieren (klein, Satzzeichen weg); false, wenn er auf `?` endet oder ein Verneinungswort (`nein`, `nicht`, `kein`, `stopp`, `warte`, `doch nicht`, `abbrechen`) enthält; true, wenn er ein Zustimmungswort (`ja`, `jawohl`, `okay`, `ok`, `bestätigt`, `bestätige`, `mach`, `los`, `genau`) enthält. Store entscheidet anhand der **letzten** Äußerung nach `createdAt`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: confirmation guard for dangerous HA actions`.

### Task 4: Home-Assistant-Client und Tool-Endpunkte

**Files:**
- Create: `server/ha/client.ts`, `server/ha/routes.ts`
- Modify: `server/app.ts` (Routen montieren, hinter `requireAuth`)
- Test: `server/ha/routes.test.ts`

**Interfaces:**
- Consumes: `ConfirmationStore`, `needsConfirmation` (Task 3), `requireAuth` (Task 2).
- Produces:
  - `interface HaClient { callTool(name: string, args: Record<string, unknown>): Promise<unknown> }` und `createHaClient(url: string, token?: string): HaClient` – nutzt `Client` + `StreamableHTTPClientTransport` aus `@modelcontextprotocol/sdk`, verbindet lazy beim ersten Aufruf, verbindet nach Fehler neu; `token` (falls gesetzt) als `Authorization: Bearer`-Header. Rückgabe: geparster Text-Inhalt des MCP-Ergebnisses (JSON, falls parsebar).
  - Endpunkte (alle `POST`, Body = Funktionsargumente, Antwort immer `200` JSON, Fehler als `{ error: string }`):
    - `/api/tools/ha_search` `{ query: string }` → ruft ha-mcp `ha_search`; filtert auf Allowlist, falls gesetzt.
    - `/api/tools/ha_get_state` `{ entity_id: string }` → ha-mcp `ha_get_state`.
    - `/api/tools/ha_call_service` `{ domain: string; service: string; entity_id: string; data?: object }` → holt erst Zustand via `ha_get_state`; bestätigungspflichtig → `{ status: "confirmation_required", action_id, description }`, sonst ha-mcp `ha_call_service` → `{ status: "done", result }`.
    - `/api/tools/confirm_action` `{ action_id: string }` → `store.take`; Erfolg → `ha_call_service` ausführen → `{ status: "done" }`; sonst `{ error: "unknown" | "expired" | "not_confirmed" }`.
    - `/api/transcript` `{ text: string }` → `store.addUtterance`, `204`.
  - Unbekannter Tool-Name → `{ error: "unknown_tool" }`.

- [ ] **Step 0:** Gegen ein laufendes ha-mcp (oder dessen README) prüfen, dass die Tool-Namen `ha_search`, `ha_get_state`, `ha_call_service` und deren Argumentnamen stimmen; Abweichungen nur in `routes.ts` anpassen.
- [ ] **Step 1: Failing tests** mit Fake-`HaClient` (zeichnet Aufrufe auf):
  - ohne Cookie → `401`.
  - `ha_call_service` auf `light.wohnzimmer` → Fake bekommt `ha_call_service`, Antwort `status: "done"`.
  - `ha_call_service` auf `lock.haustuer` → **kein** `ha_call_service`-Aufruf, Antwort `confirmation_required` mit `action_id`; danach `/api/transcript` `"Ja"` und `confirm_action` → genau ein `ha_call_service`-Aufruf.
  - `confirm_action` ohne vorheriges `"Ja"` → `{ error: "not_confirmed" }`, kein Aufruf.
  - Allowlist `["light.wohnzimmer"]`: `ha_call_service` auf `light.kueche` → `{ error: ... }`, kein Aufruf; `ha_search` liefert nur erlaubte Entitäten.
  - Fake wirft → `200` mit `{ error }`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: HA tool endpoints via ha-mcp`.

### Task 5: Live-Session-Endpunkt und Session-Konfiguration

**Files:**
- Create: `server/live.ts`, `server/prompt.ts`
- Modify: `server/app.ts`, `server/index.ts` (Create: Einstieg, lädt Config, baut echte Clients, `serve` auf `PORT`, liefert `dist/` statisch mit SPA-Fallback via `serveStatic` aus `@hono/node-server/serve-static`)
- Test: `server/live.test.ts`

**Interfaces:**
- Produces:
  - `buildSessionConfig(config: Config): object` – `model: "gpt-live-1"`, Sprachmodell-Prompt aus `prompt.ts`, `delegation: { type: "responses", responses: { model: config.liveBackendModel, instructions: BACKEND_PROMPT, tools: [ { type: "web_search" }, ...HA_TOOL_DEFS ] } }`.
  - `HA_TOOL_DEFS` in `prompt.ts`: Responses-Function-Tools (`type: "function"`, `name`, `description` auf Deutsch, JSON-Schema-`parameters`) für `ha_search`, `ha_get_state`, `ha_call_service`, `confirm_action` – exakt die Argumente aus Task 4.
  - `interface LiveClient { create(session: object, sdp: string): Promise<{ id: string; sdp: string }> }`, `createLiveClient(apiKey: string): LiveClient` über `openai`-SDK `client.live.create({ session, transport: { type: "webrtc", sdp } })`.
  - `POST /api/session` (hinter Auth) Body `{ sdp: string }` → `{ sdp: string, id: string }`; fehlendes `sdp` → `400`; Fehler von OpenAI → `502` `{ error }` (ohne Key-Inhalte).
- Prompt-Inhalte (Spec „Prompt des Sprachmodells“): Deutsch, freundlich, knapp; Wetter und Home Assistant an das Backend delegieren; Wetter für den genannten Ort, sonst nachfragen; nach Schaltungen kurz sagen, was getan wurde. Backend-Prompt: bei `confirmation_required` die `description` vorlesen lassen und nachfragen, nach Zustimmung `confirm_action` mit der `action_id` aufrufen, nie raten.

- [ ] **Step 0:** In https://developers.openai.com/api/docs/guides/live-prompting und …/guides/voice-webrtc?api=live die exakten Feldnamen für Prompt (`instructions`?) und Stimme der Live-Session nachsehen und prüfen, ob `client.live.create` in der installierten SDK-Version existiert (sonst `fetch` auf `https://api.openai.com/v1/live/sessions` mit gleichem Body). Ergebnis als Kommentar in `live.ts`.
- [ ] **Step 1: Failing tests:** `buildSessionConfig` enthält `model: "gpt-live-1"`, `delegation.type: "responses"`, Backend-Modell aus Config, Tools enthalten `web_search` und die vier HA-Namen; `JSON.stringify(buildSessionConfig(cfg))` enthält weder `openaiApiKey` noch `haToken` noch `appPassword`. Route: ohne Auth `401`; ohne `sdp` `400`; Fake-`LiveClient` gibt `{ id, sdp: "answer" }` → Antwort `{ sdp: "answer", id }`; Fake wirft → `502`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: live session endpoint with responses delegation`.

### Task 6: Frontend-Gerüst, Theme, Login-Screen

**Files:**
- Create: `index.html`, `vite.config.ts`, `components.json`, `web/main.tsx`, `web/App.tsx`, `web/index.css`, `web/components/LoginScreen.tsx`, `web/lib/api.ts`, shadcn-Komponenten unter `web/components/ui/` (`button`, `input`)

**Interfaces:**
- Produces: `api.ts`: `login(password: string): Promise<"ok" | "wrong" | "locked">`, `me(): Promise<boolean>`, `postJson<T>(path: string, body: unknown): Promise<T>` (wirft bei `401` einen `UnauthorizedError`). `App` zeigt `LoginScreen`, bis `me()` true ist, dann `<VoiceScreen />` (Task 8; bis dahin Platzhalter).

- [ ] **Step 1:** `react react-dom`, dev `vite @vitejs/plugin-react @types/react @types/react-dom tailwindcss @tailwindcss/vite` installieren; shadcn per `npx shadcn@latest init` (Tailwind v4, Alias `@/` → `web/`), dann `button input` hinzufügen. Vite-Dev-Proxy `/api` → `http://localhost:8080`.
- [ ] **Step 2:** Theme in `index.css` als CSS-Variablen: Hintergrund radialer Verlauf `#0b2a5c` → `#050d1f` → `#02060f`, Akzent `#5fb0ff`/`#2a7bff`, Text `#cfe3ff`; feines Gitter (24 px, `rgba(80,160,255,.07)`); shadcn-Tokens darauf mappen (Dark only).
- [ ] **Step 3:** `LoginScreen`: zentriertes Kennwortfeld + Button „Anmelden“; Meldungen „Kennwort falsch“ / „Zu viele Versuche – bitte später erneut“.
- [ ] **Step 4: Verifizieren:** `npm run dev:server` + `npm run dev:web`, im Browser (Handy-Viewport 375×812): falsches Kennwort → Meldung; richtiges → Platzhalter erscheint; Reload → bleibt eingeloggt.
- [ ] **Step 5:** Commit `feat: web scaffold, theme and login screen`.

### Task 7: Live-Verbindung und Delegations-Handler

**Files:**
- Create: `web/lib/live.ts`, `web/lib/delegation.ts`
- Test: `web/lib/delegation.test.ts`

**Interfaces:**
- Consumes: `postJson` (Task 6), Endpunkte aus Task 4/5.
- Produces:
  - `type LiveEvents = { onState(s: "connecting" | "connected" | "closed"): void; onUserText(text: string, final: boolean): void; onAssistantText(text: string, final: boolean): void; onWorking(active: boolean): void; onError(msg: string): void }`
  - `connectLive(ev: LiveEvents): Promise<{ close(): void; micStream: MediaStream; remoteStream: MediaStream }>` – `getUserMedia({ audio: true })`, `RTCPeerConnection`, Datenkanal `oai-events` vor `createOffer`, Offer an `/api/session`, `setRemoteDescription({ type: "answer", sdp })`, Remote-Audio in ein `<audio autoplay>`; `connected` erst bei `session.started`; `close()` sendet `{ type: "session.close" }`, wartet max. 2 s auf `session.closed`, schließt dann.
  - `createDelegationHandler(send: (msg: object) => void, callTool: (name: string, args: unknown) => Promise<unknown>, onWorking: (active: boolean) => void): (event: any) => Promise<void>` – reagiert auf `session.delegation.created` (`onWorking(true)`) und `response.event`-Umschläge mit `event.type === "response.output_item.done"` und `item.type === "function_call"`: `arguments` parsen, `callTool(item.name, args)`, dann `send({ type: "response.item.create", item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result) } })` und `send({ type: "response.create" })`. `onWorking(false)`, sobald keine Aufrufe mehr offen sind und das Backend fertig ist.
  - Transkript-Weiterleitung: jede **finale** Nutzeräußerung (`session.input_transcript.*`) → `postJson("/api/transcript", { text })`.

- [ ] **Step 0:** In https://developers.openai.com/api/docs/guides/live-delegation die genaue Form von `response.event`/`function_call`-Items und die Events für „Transkript final“ bzw. „Backend fertig“ nachschlagen; Event-Namen als Konstanten oben in `live.ts`/`delegation.ts`.
- [ ] **Step 1: Failing tests** (`delegation.test.ts`, Fake-`send`/`callTool`):
  - Umschlag mit `function_call` `name: "ha_get_state"`, `arguments: '{"entity_id":"light.a"}'`, `call_id: "c1"` → `callTool("ha_get_state", { entity_id: "light.a" })`, dann genau zwei `send`-Aufrufe in Reihenfolge `response.item.create` (mit `call_id: "c1"`) und `response.create`.
  - `arguments: "{kaputt"` → **kein** `callTool`, aber `function_call_output` mit `{"error":"invalid_arguments"}` und `response.create`.
  - `callTool` wirft → `function_call_output` mit `{ error }`.
  - Andere Event-Typen → kein `send`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: live WebRTC connection and delegation handler`.

### Task 8: Sprach-Screen „Wellenform“

**Files:**
- Create: `web/components/VoiceScreen.tsx`, `web/components/Waveform.tsx`, `web/components/MicButton.tsx`, `web/components/Subtitles.tsx`, `web/lib/wakeLock.ts`
- Modify: `web/App.tsx`

**Interfaces:**
- Consumes: `connectLive`, `LiveEvents` (Task 7).
- Produces: `Waveform({ mode, micStream, remoteStream }: { mode: "idle" | "user" | "assistant" | "working"; micStream?: MediaStream; remoteStream?: MediaStream })`; `wakeLock.ts`: `acquire(): Promise<void>`, `release(): void` (no-op, wenn API fehlt).

- [ ] **Step 1:** `Waveform`: Canvas, volle Breite, zwei überlagerte Linien mit horizontalem Verlaufs-Fade an den Rändern; Amplitude aus `AnalyserNode` des aktiven Streams. Farben: `user` `#6fc3ff`, `assistant` `#e6f1ff`, `working` ruhiger Sinus-Puls in `#5fb0ff` unabhängig vom Pegel, `idle` fast flach mit leichtem Glimmen. `mode` = `assistant`, wenn Remote-Pegel über Schwelle, sonst `user`, wenn Mic-Pegel über Schwelle, sonst `working`, wenn `onWorking(true)`, sonst `idle`.
- [ ] **Step 2:** `Subtitles`: letzte Nutzerfrage (`#7fb6ff`) und Antwort (`#e6f1ff`), live aktualisiert, zentriert unter der Welle. `MicButton`: groß (≥ 72 px), unten mittig, Glow bei aktiv, `aria-label` „Gespräch starten“/„Gespräch beenden“. Fehlermeldung über dem Button.
- [ ] **Step 3:** `VoiceScreen` verdrahtet alles: Klick → `connectLive` + `acquire()`; zweiter Klick oder `closed` → `close()` + `release()`, zurück auf `idle`; kein Auto-Reconnect. Fehlertexte: Mikrofon verweigert → „Kein Mikrofonzugriff – bitte im Browser erlauben“; Verbindung verloren → „Verbindung getrennt“; `UnauthorizedError` → zurück zum Login.
- [ ] **Step 4: Verifizieren (manuell, echter Key + ha-mcp):** im Handy-Viewport und auf einem echten Handy über HTTPS (Tunnel oder `vite --host` + HTTPS): (a) „Wie ist das Wetter in Hamburg?“ → gesprochene Antwort, Welle pulsiert während der Suche; (b) „Wie ist das Wetter?“ → er fragt nach dem Ort; (c) ins Wort fallen → er stoppt sofort; (d) Licht schalten → passiert sofort, er sagt es; (e) „Schließ die Haustür auf“ → er fragt nach, „nein“ → nichts passiert, erneut + „ja“ → passiert; (f) Display geht während des Gesprächs nicht aus. Ergebnisse (inkl. ob Deutsch gut funktioniert) in `docs/superpowers/plans/2026-10-29-poc-verification.md` festhalten.
- [ ] **Step 5:** Commit `feat: waveform voice screen`.

### Task 9: Docker

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- Modify: `README.md` (Create: kurz Start lokal, Env, Docker, Cloudflare-Tunnel-Hinweis auf Port `8080`)

- [ ] **Step 1:** `Dockerfile` multi-stage: Stage `build` `FROM node:26-slim` → `npm ci`, `npm run build`, `npm prune --omit=dev`. Stage `runtime` `FROM ubuntu:24.04` → Node-Binary per `COPY --from=build /usr/local/bin/node /usr/local/bin/node`, `ca-certificates` installieren, `dist/`, `server/`, `node_modules/`, `package.json` kopieren, Non-Root-User `app`, `ENV NODE_ENV=production PORT=8080`, `EXPOSE 8080`, `CMD ["node", "server/index.ts"]`. `.dockerignore`: `node_modules`, `.env`, `.git`, `.superpowers`, `docs`.
- [ ] **Step 2:** `docker-compose.yml`: Service `assist`, `build: .`, `env_file: .env`, `ports: ["8080:8080"]`, `restart: unless-stopped`.
- [ ] **Step 3: Verifizieren (auf dem Linux-Host, lokal ist kein Docker installiert):** `docker compose up --build -d`; `curl -i localhost:8080/` → `200` HTML; `curl -i -X POST localhost:8080/api/session` → `401`; `docker compose exec assist id -u` ≠ `0`; `docker image inspect` zeigt keine Secrets in `Env`.
- [ ] **Step 4:** Commit `feat: docker image and compose`.
