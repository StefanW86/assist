# Voice-Assistant PoC – Design

Stand: 2026-10-29

## Intent – warum

Ein persönlicher KI-Assistent, mit dem man spricht wie mit einem Menschen: ohne Knopfdruck pro Satz, mit kaum Verzögerung, mit der Möglichkeit, ihm ins Wort zu fallen. Der PoC soll beweisen, dass sich dieses Gesprächsgefühl mit `gpt-live-1` erreichen lässt und dass der Assistent im Gespräch echte Arbeit erledigen kann: das aktuelle Wetter nachschlagen und das eigene Zuhause über Home Assistant abfragen und schalten.

Hauptnutzung: Handy, zu Hause und unterwegs.

## Ziele (PoC)

1. Mikrofonbutton startet ein Live-Gespräch, ein zweiter Klick beendet es.
2. Full-Duplex-Gespräch auf Deutsch: Assistent erkennt selbst, wann der Nutzer fertig ist; Unterbrechen stoppt ihn sofort.
3. Frage nach dem aktuellen Wetter wird über Websuche beantwortet.
4. Home Assistant: Zustände abfragen und Geräte schalten.
5. Erreichbar vom Handy über Cloudflare Tunnel, geschützt durch Kennwort-Login.
6. Läuft als Docker-Container (Ubuntu-Basis) auf einem Linux-Host.

## Nicht-Ziele (PoC)

- Gmail, Obsidian, Telefonie (später; Architektur darf sie nicht verbauen – siehe „Ausblick“).
- Mehrere Nutzer, Benutzerverwaltung.
- Gesprächsverlauf speichern.
- Native App.

## Anti-Ziele (wäre ein Fehlschlag, selbst wenn es technisch läuft)

- Spürbare Verzögerung oder „Walkie-Talkie“-Gefühl (Knopf drücken pro Satz).
- OpenAI-API-Key oder Home-Assistant-Token gelangen in den Browser oder zu OpenAI.
- Jemand ohne Kennwort kann über die öffentliche Tunnel-Adresse sprechen, schalten oder Kosten verursachen.
- Assistent schließt Türen auf o. ä., ohne vorher nachzufragen.

## Festgelegt vom Nutzer

- React-Webapp, aktuelle LTS-Versionen (Node LTS zum Bauzeitpunkt prüfen).
- Tailwind CSS + shadcn/ui.
- Sprachmodell: `gpt-live-1` (OpenAI Live API).
- Design: futuristisch, dunkelblaue Töne, Variante **„Wellenform“** (siehe unten).
- Home Assistant ist **nicht** von außen erreichbar.
- Assistent darf Home Assistant auch **schalten**.
- Bestätigungsregel: Licht, Steckdosen, Heizung, Rollläden sofort; **Schlösser, Alarmanlage, Garagentor** nur nach gesprochenem „Ja“.
- Zugriff von unterwegs über **Cloudflare Tunnel** (vom Nutzer betrieben).
- Schutz: **einfacher Login, nur Kennwort**.
- Betrieb: **Docker-Container auf Ubuntu-Basis**, Dockerfile ist Teil des Lieferumfangs.

## Architektur

```
Handy-Browser (React)
  │  HTTPS via Cloudflare Tunnel
  ▼
Node-Server (im Docker-Container)  ──►  Home Assistant MCP (Heimnetz)
  │  API-Key, nur serverseitig
  ▼
OpenAI Live API  (/v1/live/sessions, gpt-live-1)
  └─ Responses-Delegation → Backend-Modell + Websuche
```

Ein Container liefert sowohl die gebaute React-App (statisch) als auch die API-Endpunkte aus. Ein Port, den der Cloudflare Tunnel anspricht.

### Verbindung (laut OpenAI-Doku)

- Browser baut eine WebRTC-Verbindung auf: Mikrofon-Track, Audio-Wiedergabe, Datenkanal `oai-events` (vor dem SDP-Offer anlegen).
- Browser schickt SDP-Offer an `POST /api/session` des eigenen Servers.
- Server ruft `POST /v1/live/sessions` mit `session` (Modell, Prompt, Delegation) und `transport: { type: "webrtc", sdp }` auf und gibt die SDP-Antwort zurück. Die HTTP-Anfrage startet die Session; kein `session.start` senden.
- Browser wartet auf `session.started`. Beenden mit `session.close`, auf `session.closed` warten.
- Mitschrift über `session.input_transcript.delta` / `session.output_transcript.delta`.

Doku: https://developers.openai.com/api/docs/guides/live, …/guides/voice-webrtc?api=live, …/guides/live-delegation, …/guides/live-prompting

### Delegation („harte Arbeit“)

- `delegation.type: "responses"` (von OpenAI verwaltet). Backend-Modell laut Doku-Empfehlung `gpt-6-luna` (für schwierige Aufgaben `gpt-6-sol`) – Modell konfigurierbar per Env.
- Tools in `delegation.responses.tools`:
  - **Websuche** (gehostetes Tool) – für das Wetter.
  - **Home Assistant als eigene Funktionen** (custom functions), nicht als MCP-Tool, weil OpenAI den internen HA nicht erreicht.
- Ablauf HA-Aufruf: Backend-Event `response.output_item.done` (function call) kommt im Browser im Datenkanal an (verpackt in `response.event`) → Browser ruft `POST /api/tools/<name>` am eigenen Server → Server spricht mit dem HA-MCP im Heimnetz → Ergebnis zurück an Browser → Browser sendet `response.item.create` (`function_call_output`, gleiche `call_id`) und `response.create`.
- Der HA-Token liegt nur im Server. OpenAI sieht nur die Funktionsergebnisse.

### Home-Assistant-Funktionen

MCP-Server: **`ha-mcp`** (Community-Server, homeassistant-ai/ha-mcp), läuft im Heimnetz als eigener Dienst mit HTTP-Transport; `HA_MCP_URL` zeigt darauf. Nicht die eingebaute HA-MCP-Integration (die liefert keine generischen Service-Calls, keine `entity_id`/`domain`/`device_class`).

Funktionsumfang mindestens: Entitäten/Geräte finden, Zustand lesen, Dienst aufrufen (schalten). Konkreter Zuschnitt der Funktionen (wenige generische vs. mehrere spezifische) ist Sache des Builders.

Sichtbarkeit: standardmäßig alle Entitäten; optional einschränkbar über `HA_ENTITY_ALLOWLIST` (meine Wahl).

**Bestätigung (Sicherheitsregel, serverseitig durchgesetzt):**

- Bestätigungspflichtig: Domains `lock` und `alarm_control_panel` automatisch, `cover` mit `device_class` `garage`/`gate`, plus jede Entität in `HA_CONFIRM_ENTITIES` (kommagetrennte Liste, z. B. Garagentor-Relais als `switch`) (meine Wahl).
- Ablauf: Ein schaltender Aufruf auf eine solche Entität wird **nicht** ausgeführt. Der Server legt eine ausstehende Aktion an (ID, Entität, Dienst, Zeitstempel, Ablauf nach 60 s) und antwortet „Bestätigung erforderlich: <Beschreibung>“. Das Modell fragt per Sprache nach.
- Der Browser schickt jede abgeschlossene Nutzeräußerung (aus `session.input_transcript.*`) an `POST /api/transcript`.
- Bestätigen: Funktion `confirm_action(id)`. Der Server führt nur aus, wenn nach dem Anlegen der Aktion eine Nutzeräußerung eingegangen ist, die eindeutig zustimmt (z. B. „ja“, „mach“, „bestätigt“; keine Verneinung enthalten). Sonst Ablehnung.
- Ein `confirmed`-Flag des Modells allein reicht ausdrücklich nicht (meine Wahl; Grund: ein Modell, das das Nachfragen fälschlich überspringt, setzt auch das Flag fälschlich).

### Login

- Ein Kennwort, in `.env` (`APP_PASSWORD`) – nie im Code oder Image.
- Login-Screen im gleichen Stil, ein Feld.
- Erfolg → signiertes, `httpOnly`, `secure`, `sameSite=strict` Cookie, Laufzeit 30 Tage (meine Wahl).
- Alle `/api/*`-Endpunkte außer Login prüfen das Cookie.
- Rate-Limit beim Login: nach 5 Fehlversuchen 15 Minuten Sperre pro IP (meine Wahl; IP aus `CF-Connecting-IP`, da hinter Tunnel).
- Kennwortvergleich timing-sicher.

### Konfiguration (Env)

`OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `HA_MCP_URL`, `HA_TOKEN` (falls ha-mcp eine Auth verlangt), `HA_CONFIRM_ENTITIES`, `HA_ENTITY_ALLOWLIST`, `LIVE_BACKEND_MODEL` (Default `gpt-6-luna`), `PORT`. Eine `.env.example` liegt im Repo.

### Docker

- Dockerfile auf Ubuntu-Basis, Multi-Stage: Build der React-App, schlankes Runtime-Image mit Node LTS.
- Container läuft als Non-Root, ein Port, Konfiguration nur über Env.
- `docker-compose.yml` als Beispiel für den Betrieb (Env-Datei, Port, Restart-Policy).
- Cloudflare Tunnel betreibt der Nutzer selbst; nicht Teil des Containers.

## UI – Variante „Wellenform“

Mobile-first, Hochformat, funktioniert auch am PC.

- Hintergrund: radialer Verlauf Dunkelblau → fast Schwarz, feines, kaum sichtbares Gitter.
- Mitte: leuchtende Audiowelle über die ganze Breite (SVG/Canvas), reagiert auf Audiopegel.
  - Nutzer spricht: kühles Hellblau (meine Wahl).
  - Assistent spricht: heller/weißlicher (meine Wahl).
  - Hintergrundarbeit (Delegation/Tool läuft): ruhiger Puls (meine Wahl).
  - Ruhe: fast flach, leichtes Glimmen.
- Darunter: Untertitel im Filmstil – letzte Nutzerfrage und Antwort, live mitlaufend.
- Unten mittig: großer Mikrofonbutton (daumenfreundlich), leuchtet bei aktivem Gespräch.
- Fehler (kein Mikro-Zugriff, Verbindung weg, nicht eingeloggt): kurze Meldung über dem Button.
- Bestätigung für Schlösser etc. nur per Sprache, keine Extra-Buttons (meine Annahme).
- Bildschirm bleibt während des Gesprächs an (Nutzer-Entscheidung): Screen Wake Lock API, solange die Session läuft. Betrieb mit gesperrtem Bildschirm/Hintergrund ist **kein** Ziel. Bei Verbindungsabbruch (z. B. Tab im Hintergrund) Status zurück auf „aus“ und Meldung; kein Auto-Reconnect (meine Wahl).

Referenz-Mockup: `.superpowers/brainstorm/*/content/hauptscreen.html` (Variante C).

## Prompt des Sprachmodells (Eckpunkte)

Deutsch, freundlich, knapp. Delegiert Wetter- und Home-Assistant-Fragen an das Backend. Wetter gilt für den Ort, den der Nutzer im Gespräch nennt (Nutzer-Entscheidung; keine Geolocation). Nennt er keinen, fragt der Assistent nach (meine Wahl). Fragt vor Schloss/Alarm/Garage nach. Sagt nach Schaltungen kurz, was getan wurde. Feinschliff nach `live-prompting`-Guide ist Sache des Builders.

## Ausblick (darf nicht verbaut werden)

- Weitere Datenquellen (Gmail, Obsidian-Markdown, weitere MCPs) kommen als zusätzliche Funktionen bzw. Tools in die Delegation.
- Telefonie: OpenAI Live unterstützt SIP. Später eigener Einstieg neben dem Browser.

## Offene Punkte / Risiken

- Ob `gpt-live-1` Deutsch offiziell unterstützt und welche Stimmen es gibt, stand nicht in der gelesenen Doku – früh im Bau prüfen.
- Turn-Detection-Parameter nicht dokumentiert gefunden – Defaults verwenden, falls nötig nachschlagen.
- Live API nicht im Free-Tier; Kosten 0,05 $/Min + Backend-Modell.
- Delegations-Modus ist pro Session fest.

## Dem Builder überlassen

Projektstruktur, Server-Framework, Wahl der Audio-Visualisierung (SVG vs. Canvas), Zuschnitt der HA-Funktionen, Teststrategie, konkrete shadcn-Komponenten.
