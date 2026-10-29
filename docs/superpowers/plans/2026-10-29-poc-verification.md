# PoC-Verifikation – Sprachassistent (Task 8, Schritt 4)

Diese Prüfungen brauchen einen echten OpenAI-Key und einen erreichbaren ha-mcp-Server. Sie sind noch **nicht** durchgeführt.

## So testest du

1. `.env` im Projektordner anlegen (Vorlage: `.env.example`, nie committen):
   - `OPENAI_API_KEY` – echter Key mit Zugriff auf `gpt-live-1`
   - `APP_PASSWORD` – beliebiges Login-Kennwort
   - `SESSION_SECRET` – Zufallsstring, mind. 32 Zeichen (`openssl rand -hex 32`)
   - `HA_MCP_URL` – geheime URL deines ha-mcp-Servers; `HA_TOKEN` nur, falls ha-mcp selbst einen Bearer-Token verlangt
   - optional `HA_CONFIRM_ENTITIES`, `HA_ENTITY_ALLOWLIST`, `LIVE_BACKEND_MODEL`, `PORT`
2. `npm run build && npm start` (Server auf Port 8080).
3. Auf dem Handy öffnen – Mikrofon und Wake Lock gehen nur über HTTPS, z. B. per Tunnel (`cloudflared tunnel --url http://localhost:8080`) oder `vite --host` mit HTTPS. Anmelden, auf den Mikrofon-Knopf tippen, Mikrofon erlauben.
4. Ergebnisse unten abhaken und Auffälligkeiten notieren.

## Checkliste

- [ ] (a) „Wie ist das Wetter in Hamburg?“ → gesprochene Antwort; die Welle pulsiert ruhig, während er sucht.
- [ ] (b) „Wie ist das Wetter?“ → er fragt nach dem Ort.
- [ ] (c) Ins Wort fallen, während er spricht → er hört sofort auf.
- [ ] (d) Licht schalten (z. B. „Mach das Licht im Wohnzimmer an“) → passiert sofort, und er sagt es.
- [ ] (e) „Schließ die Haustür auf“ → er fragt nach; „nein“ → nichts passiert; erneut fragen + „ja“ → Tür wird aufgeschlossen.
- [ ] (e2) „Schließ die Haustür auf“ → „Nein“ sagen, danach eine andere Ja-Frage beantworten → Tür bleibt zu.
- [ ] (f) Das Display geht während des Gesprächs nicht aus.
- [ ] (g) iPhone: Die Welle reagiert auf deine Stimme und auf die des Assistenten.
- [ ] (h) 5 Minuten nichts sagen → Gespräch endet mit der Meldung „Gespräch wegen Inaktivität beendet“.

## Ergebnisse

- Deutsch (Verständnis, Aussprache, Untertitel):
- Welle/Farben (blau = du, weiß = Assist, Puls = arbeitet):
- Sonstiges:
