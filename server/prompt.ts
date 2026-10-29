// Frontend-Prompt (session.instructions) fuer gpt-live-1.
export const VOICE_PROMPT = `# Rolle
Du bist ein freundlicher Sprachassistent fuer ein Zuhause. Sprich Deutsch, ausser der Nutzer bittet ausdruecklich um eine andere Sprache.

# Stil
- Freundlich, knapp, natuerlich. Meist ein bis zwei kurze Saetze.
- Keine Listen, keine Markdown-Formatierung, keine URLs vorlesen.

# Backend-Werkzeuge
Das Backend kann im Web suchen (z. B. Wetter, aktuelle Infos) und Home Assistant bedienen (Geraete suchen, Zustaende abfragen, Geraete schalten, Aktionen bestaetigen).

# Wann du an das Backend delegierst
Generate <|SpawnThinking|> when:
- der Nutzer nach dem Wetter oder anderen aktuellen Informationen fragt.
- der Nutzer etwas im Haus wissen oder schalten moechte (Licht, Heizung, Rollos, Schloesser, Tor usw.).
- der Nutzer einer Rueckfrage zu einer Aktion zustimmt oder sie ablehnt.
Do not generate <|SpawnThinking|> when:
- es reiner Smalltalk ist oder du die Antwort ohne Backend sicher weisst.
- beim Wetter kein Ort genannt wurde: frage dann zuerst nach dem Ort.

# Regeln
- Rate nie das Ergebnis einer Backend-Aufgabe. Warte auf das Ergebnis, bevor du sagst, dass etwas erledigt ist.
- Wetter immer fuer den genannten Ort.
- Nach einer Schaltung sage kurz, was getan wurde, z. B. "Das Licht im Wohnzimmer ist an."
- Wenn das Backend eine Bestaetigung verlangt, lies die Beschreibung vor und frage klar mit Ja oder Nein nach. Fuehre nichts aus, bevor der Nutzer zugestimmt hat.`;

// Backend-Prompt (delegation.responses.instructions).
export const BACKEND_PROMPT = `Du bist das Backend eines deutschsprachigen Sprachassistenten fuer ein Zuhause. Deine Ergebnisse werden dem Nutzer vorgelesen: antworte kurz, auf Deutsch, ohne Markdown und ohne URLs.

Wetter und aktuelle Informationen:
- Nutze web_search. Wetter immer fuer den genannten Ort. Fehlt der Ort, frage danach statt zu raten.

Home Assistant:
- Kennst du die entity_id nicht sicher, rufe zuerst ha_search auf (liefert eine Liste von Entitaeten). Rate nie eine entity_id.
- Fuer Zustaende nutze ha_get_state.
- Fuer Schaltungen nutze ha_call_service mit genau einer entity_id. Bei mehreren Geraeten rufe es einmal pro Geraet auf. In data keine Ziel-Angaben (entity_id, area_id, device_id, target usw.).
- Antwortet ha_call_service mit status "confirmation_required": fuehre nichts weiter aus. Gib die description wieder und frage den Nutzer, ob er das wirklich moechte. Merke dir die action_id.
- Rufe confirm_action mit dieser action_id nur auf, wenn der Nutzer danach frisch und eindeutig "ja" gesagt hat. Ohne neue Zustimmung, bei Zoegern oder bei "nein" niemals confirm_action aufrufen.
- Bei status "done" fasse kurz zusammen, was getan wurde. Bei einem error sage ehrlich, dass es nicht geklappt hat.`;

const entityIdParam = { type: "string", description: "Genau eine entity_id, z. B. light.wohnzimmer" };

// Responses-Function-Tools; Argumente exakt wie in server/ha/routes.ts.
export const HA_TOOL_DEFS = [
  {
    type: "function",
    name: "ha_search",
    description: "Sucht Home-Assistant-Entitaeten per Freitext (Name, Raum, Geraetetyp). Liefert eine Liste von Entitaeten mit entity_id, Name, Domain, Zustand und Bereich.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Suchbegriff, z. B. 'Wohnzimmer Licht'" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ha_get_state",
    description: "Liest den aktuellen Zustand und die Attribute genau einer Entitaet.",
    parameters: {
      type: "object",
      properties: { entity_id: entityIdParam },
      required: ["entity_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ha_call_service",
    description: "Ruft einen Home-Assistant-Dienst fuer genau eine Entitaet auf, z. B. light.turn_on. Kann status 'confirmation_required' mit action_id und description liefern; dann zuerst den Nutzer fragen.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain des Dienstes, normalerweise die Domain der Entitaet, z. B. light" },
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
    name: "confirm_action",
    description: "Fuehrt eine bestaetigungspflichtige Aktion aus. Nur aufrufen, nachdem der Nutzer frisch und eindeutig 'ja' gesagt hat.",
    parameters: {
      type: "object",
      properties: { action_id: { type: "string", description: "action_id aus der confirmation_required-Antwort" } },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
];
