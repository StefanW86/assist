// WebRTC-Ablauf laut https://developers.openai.com/api/docs/guides/voice-webrtc?api=live (geprueft 2026-10-29):
// Datenkanal "oai-events" vor createOffer, kein session.start senden, auf session.started warten,
// Ende mit session.close und erst nach session.closed die Verbindung schliessen.
import { postJson } from "./api.ts";
import {
  createDelegationHandler,
  createTranscript,
  DELEGATION_CREATED,
  INPUT_TRANSCRIPT_DELTA,
  OUTPUT_TRANSCRIPT_DELTA,
  SESSION_CLOSED,
} from "./delegation.ts";

const DATA_CHANNEL = "oai-events";
const SESSION_STARTED = "session.started";
const SESSION_CLOSE = "session.close";
const ERROR = "error";

export type LiveEvents = {
  onState(s: "connecting" | "connected" | "closed"): void;
  onUserText(text: string, final: boolean): void;
  onAssistantText(text: string, final: boolean): void;
  onWorking(active: boolean): void;
  onError(msg: string): void;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function connectLive(ev: LiveEvents): Promise<{ close(): void; micStream: MediaStream; remoteStream: MediaStream }> {
  ev.onState("connecting");
  let micStream: MediaStream | undefined;
  const remoteStream = new MediaStream();
  const pc = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.srcObject = remoteStream;
  document.body.append(audio);

  let closed = false;
  const teardown = () => {
    if (closed) return;
    closed = true;
    pc.close();
    micStream?.getTracks().forEach((t) => t.stop());
    audio.remove();
    ev.onWorking(false);
    ev.onState("closed");
  };

  try {
    // Echo-Unterdrueckung: das eigene "Ja oder Nein?" des Assistenten darf nicht als Nutzereingabe zurueckkommen
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micStream = mic;
    for (const track of mic.getTracks()) pc.addTrack(track, mic);
    pc.ontrack = (e) => remoteStream.addTrack(e.track);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") ev.onError("Verbindung getrennt");
      if (pc.connectionState === "failed" || pc.connectionState === "closed") teardown();
    };
    const dc = pc.createDataChannel(DATA_CHANNEL);
    const send = (msg: object) => {
      if (dc.readyState !== "open") return false;
      dc.send(JSON.stringify(msg));
      return true;
    };

    // Nur finale Nutzeraeusserungen gehen an den Server (Grundlage der Bestaetigungspruefung).
    let posting: Promise<unknown> = Promise.resolve();
    const user = createTranscript(INPUT_TRANSCRIPT_DELTA, [OUTPUT_TRANSCRIPT_DELTA, DELEGATION_CREATED, SESSION_CLOSED], (text, final) => {
      ev.onUserText(text, final);
      if (final) posting = posting.then(() => postJson("/api/transcript", { text })).catch((e) => ev.onError(errMsg(e)));
    });
    const assistant = createTranscript(OUTPUT_TRANSCRIPT_DELTA, [INPUT_TRANSCRIPT_DELTA, SESSION_CLOSED], ev.onAssistantText);
    const delegation = createDelegationHandler(
      send,
      async (name, args) => {
        user.end();
        await posting; // ein "Ja" muss beim Server sein, bevor confirm_action laeuft
        return postJson(`/api/tools/${name}`, args);
      },
      ev.onWorking,
    );

    dc.onmessage = (m) => {
      let event: any;
      try {
        event = JSON.parse(m.data);
      } catch {
        return;
      }
      if (!event || typeof event !== "object") return;
      user.handle(event);
      assistant.handle(event);
      delegation(event).catch((e) => ev.onError(errMsg(e)));
      if (event.type === SESSION_STARTED) ev.onState("connected");
      if (event.type === ERROR) ev.onError(event.error?.message ?? "Unbekannter Fehler");
      if (event.type === SESSION_CLOSED) teardown(); // auch bei Ablauf/Abbruch durch den Server
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const timer = setTimeout(resolve, 10_000);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") (clearTimeout(timer), resolve());
      });
    });
    const answer = await postJson<{ sdp: string; id: string }>("/api/session", { sdp: pc.localDescription!.sdp });
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    return {
      micStream: mic,
      remoteStream,
      close() {
        if (closed) return;
        if (dc.readyState !== "open") return teardown();
        setTimeout(teardown, 2000); // max. 2 s auf session.closed warten; teardown ist idempotent
        send({ type: SESSION_CLOSE });
      },
    };
  } catch (e) {
    ev.onError(e instanceof DOMException && e.name === "NotAllowedError" ? "Kein Mikrofonzugriff – bitte im Browser erlauben" : "Verbindung fehlgeschlagen");
    teardown();
    throw e;
  }
}
