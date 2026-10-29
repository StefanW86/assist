# Assist – Sprachassistent (PoC)

Sprachassistent für Home Assistant: React/Vite-Frontend, Hono-Server (`server/`), Sprache über die OpenAI Live API (WebRTC), Steuerung über ha-mcp.

## Lokal starten

```
npm install
cp .env.example .env   # Werte eintragen
npm run dev:server     # Server auf :8080
npm run dev:web        # Vite-Dev-Server
```

## Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `OPENAI_API_KEY` | OpenAI-API-Key (nur Server) |
| `APP_PASSWORD` | Passwort für den Login |
| `SESSION_SECRET` | Zufallsstring (mind. 32 Zeichen, z. B. `openssl rand -hex 32`) zum Signieren des Session-Cookies |
| `HA_MCP_URL` | URL des ha-mcp-Servers (Streamable HTTP mit geheimem Pfad, z. B. `http://192.168.1.10:8086/<geheimer-pfad>`, siehe unten) |
| `HA_TOKEN` | Optionaler Bearer-Token für ha-mcp selbst (den Home-Assistant-Token hält ha-mcp) |
| `HA_CONFIRM_ENTITIES` | Kommaseparierte Entitäten, die immer Bestätigung brauchen |
| `HA_ENTITY_ALLOWLIST` | Kommaseparierte steuerbare Entitäten (leer = alle) |
| `LIVE_BACKEND_MODEL` | Backend-Modell für Delegation (Default `gpt-6-luna`) |
| `PORT` | Port des Servers (Default `8080`) |

## ha-mcp

`ghcr.io/homeassistant-ai/ha-mcp` im HTTP-Modus (Streamable HTTP) starten und `HA_MCP_URL` auf dessen geheime URL setzen, z. B. `http://192.168.1.10:8086/<geheimer-pfad>`. Der Home-Assistant-Token wird in ha-mcp konfiguriert, nicht in dieser App (Details im ha-mcp-Repository).

## Bestätigungsregeln

Immer mit Bestätigung (Ablauf nach 60 s): Schlösser (`lock`), Alarmanlage (`alarm_control_panel`), Garagen-/Tor-Covers (`device_class` `garage` oder `gate`). HA-Skripte, -Szenen oder -Automationen, die indirekt etwas entriegeln, müssen in `HA_CONFIRM_ENTITIES` eingetragen werden – ebenso `button.*`-, `switch.*`- oder `input_boolean.*`-Entitäten, die Türen oder Summer öffnen (z. B. Türöffner einer Gegensprechanlage).

## Docker (Linux-Host)

```
cp .env.example .env   # ausfüllen
docker compose up --build -d
curl -i localhost:8080/                       # 200, HTML
curl -i -X POST localhost:8080/api/session    # 401
docker compose exec assist id -u              # ungleich 0
docker image inspect $(docker compose images -q assist)   # keine Secrets in Env
```

`.env` wird nicht ins Image kopiert, sondern nur zur Laufzeit übergeben.

### Automatisches Deployment

`.github/workflows/deploy.yml` läuft bei jedem Push auf `main` (oder manuell) auf einem self-hosted Runner mit Label `assist` auf dem Server: `git reset --hard` auf den gepushten Commit in `/home/stefan/assist`, `docker compose up --build -d`, Healthcheck auf Port 8080, alte Images aufräumen. Die `.env` bleibt dabei unangetastet.

Das Repo ist öffentlich und der Runner läuft im Heimnetz: Unter *Settings → Actions → General* „Require approval for all external contributors“ einstellen, damit Workflows aus Fork-PRs nie ungefragt auf dem Server laufen.

## Cloudflare Tunnel

Tunnel auf `http://<host>:8080` zeigen lassen.

**Sicherheit:** Port 8080 darf nur über den Tunnel bzw. im LAN erreichbar sein, niemals per Portweiterleitung ins Internet. Der Login-Schutz (5 Fehlversuche → 15 Min Sperre) vertraut dem Header `CF-Connecting-IP`; direkt erreichbar könnte er gefälscht werden.

## Test am Handy

Siehe [docs/superpowers/plans/2026-10-29-poc-verification.md](docs/superpowers/plans/2026-10-29-poc-verification.md).
