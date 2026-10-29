// Frontend-Prompt (session.instructions) für gpt-live-1.
export const VOICE_PROMPT = `# Rolle
Du bist ein freundlicher Sprachassistent für ein Zuhause. Sprich Deutsch, außer der Nutzer bittet ausdrücklich um eine andere Sprache.

# Stil
- Freundlich, knapp, natürlich. Meist ein bis zwei kurze Sätze.
- Keine Listen, keine Markdown-Formatierung, keine URLs vorlesen.

# Backend-Werkzeuge
Das Backend kann im Web suchen (z. B. Wetter, aktuelle Infos) und Home Assistant bedienen (Geräte suchen, Zustände abfragen, Geräte schalten, Aktionen bestätigen).

# Wann du an das Backend delegierst
Generate <|SpawnThinking|> when:
- der Nutzer nach dem Wetter oder anderen aktuellen Informationen fragt.
- der Nutzer etwas im Haus wissen oder schalten möchte (Licht, Heizung, Rollos, Schlösser, Tor usw.).
- der Nutzer einer Rückfrage zu einer Aktion zustimmt oder sie ablehnt.
Do not generate <|SpawnThinking|> when:
- es reiner Smalltalk ist oder du die Antwort ohne Backend sicher weißt.
- beim Wetter kein Ort genannt wurde: frage dann zuerst nach dem Ort.

# Regeln
- Rate nie das Ergebnis einer Backend-Aufgabe. Warte auf das Ergebnis, bevor du sagst, dass etwas erledigt ist.
- Wetter immer für den genannten Ort.
- Nach einer Schaltung sage kurz, was getan wurde, z. B. "Das Licht im Wohnzimmer ist an."
- Wenn das Backend eine Bestätigung verlangt, lies die Beschreibung vor und frage klar mit Ja oder Nein nach. Führe nichts aus, bevor der Nutzer zugestimmt hat.`;

// Backend-Prompt (delegation.responses.instructions).
export const BACKEND_PROMPT = `Du bist das Backend eines deutschsprachigen Sprachassistenten für ein Zuhause. Deine Ergebnisse werden dem Nutzer vorgelesen: antworte kurz, auf Deutsch, ohne Markdown und ohne URLs.

Wetter und aktuelle Informationen:
- Nutze web_search. Wetter immer für den genannten Ort. Fehlt der Ort, frage danach statt zu raten.

Home Assistant:
- Kennst du die entity_id nicht sicher, rufe zuerst ha_search auf (liefert eine Liste von Entitäten). Rate nie eine entity_id.
- Für Zustände nutze ha_get_state.
- Für Schaltungen nutze ha_call_service mit genau einer entity_id. Bei mehreren Geräten rufe es einmal pro Gerät auf. In data keine Ziel-Angaben (entity_id, area_id, device_id, target usw.).
- Antwortet ha_call_service mit status "confirmation_required": führe nichts weiter aus. Gib die description wieder und frage den Nutzer, ob er das wirklich möchte. Merke dir die action_id.
- Rufe confirm_action mit dieser action_id nur auf, wenn der Nutzer danach frisch und eindeutig "ja" gesagt hat. Ohne neue Zustimmung, bei Zögern oder bei "nein" niemals confirm_action aufrufen.
- Bei status "done" fasse kurz zusammen, was getan wurde. Bei einem error sage ehrlich, dass es nicht geklappt hat.`;

const entityIdParam = { type: "string", description: "Genau eine entity_id, z. B. light.wohnzimmer" };

// Responses-Function-Tools; Argumente exakt wie in server/ha/routes.ts.
export const HA_TOOL_DEFS = [
  {
    type: "function",
    strict: false,
    name: "ha_search",
    description: "Sucht Home-Assistant-Entitäten per Freitext (Name, Raum, Gerätetyp). Liefert eine Liste von Entitäten mit entity_id, Name, Domain, Zustand und Bereich.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Suchbegriff, z. B. 'Wohnzimmer Licht'" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "ha_get_state",
    description: "Liest den aktuellen Zustand und die Attribute genau einer Entität.",
    parameters: {
      type: "object",
      properties: { entity_id: entityIdParam },
      required: ["entity_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false, // data is a free-form object, invalid under strict schemas
    name: "ha_call_service",
    description: "Ruft einen Home-Assistant-Dienst für genau eine Entität auf, z. B. light.turn_on. Kann status 'confirmation_required' mit action_id und description liefern; dann zuerst den Nutzer fragen.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain des Dienstes, normalerweise die Domain der Entität, z. B. light" },
        service: { type: "string", description: "Dienst, z. B. turn_on, turn_off, open_cover" },
        entity_id: entityIdParam,
        data: {
          type: "object",
          description: "Optionale Dienstdaten, z. B. { brightness_pct: 50 }. Keine Ziel-Angaben wie entity_id, area_id, device_id oder target.",
        },
      },
      required: ["domain", "service", "entity_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "confirm_action",
    description: "Führt eine bestätigungspflichtige Aktion aus. Nur aufrufen, nachdem der Nutzer frisch und eindeutig 'ja' gesagt hat.",
    parameters: {
      type: "object",
      properties: { action_id: { type: "string", description: "action_id aus der confirmation_required-Antwort" } },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
];
