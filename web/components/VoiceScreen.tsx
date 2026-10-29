import { useEffect, useRef, useState } from "react";
import { MicButton } from "@/components/MicButton";
import { Subtitles } from "@/components/Subtitles";
import { Waveform } from "@/components/Waveform";
import { UnauthorizedError } from "@/lib/api";
import { connectLive } from "@/lib/live";
import { acquire, release } from "@/lib/wakeLock";

type Live = Awaited<ReturnType<typeof connectLive>>;
const STATUS = { idle: "Bereit", connecting: "Verbinde …", connected: "Hört zu" };
const IDLE_MS = 5 * 60 * 1000;

export function VoiceScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const live = useRef<Live | null>(null);
  const [status, setStatus] = useState<keyof typeof STATUS>("idle");
  const [streams, setStreams] = useState<{ mic?: MediaStream; remote?: MediaStream; audio?: AudioContext }>({});
  const audioCtx = useRef<AudioContext | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [working, setWorking] = useState(false);
  const [user, setUser] = useState("");
  const [assistant, setAssistant] = useState("");
  const [error, setError] = useState("");

  const session = useRef(0);
  const cleanup = () => {
    clearTimeout(idle.current);
    void audioCtx.current?.close();
    audioCtx.current = null;
  };
  const reset = () => {
    session.current++;
    live.current = null;
    cleanup();
    release();
    setStreams({});
    setWorking(false);
    setStatus("idle");
  };

  async function toggle() {
    if (live.current) {
      live.current.close(); // kein Auto-Reconnect: danach bleibt es bei „Bereit“
      return reset();
    }
    // iOS: AudioContext nur innerhalb der Klick-Geste anlegen, also vor dem ersten await
    cleanup();
    // iOS knackt durchgehend, wenn der Kontext nicht mit WebRTC (48 kHz) laeuft oder mit kleinen Puffern unterlaeuft
    // shortcut: ?nowave schaltet Web Audio ab, um das iOS-Knacken einzugrenzen; nach der Diagnose entfernen
    const audio = new URLSearchParams(location.search).has("nowave") ? undefined : new AudioContext({ sampleRate: 48_000, latencyHint: "playback" });
    audioCtx.current = audio ?? null;
    void audio?.resume();
    setError("");
    setUser("");
    setAssistant("");
    // Events eines alten Gesprächs (z. B. dessen verzögertes „closed“) dürfen das neue nicht beenden.
    const id = ++session.current;
    const mine = () => id === session.current;
    const armIdle = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => {
        if (!mine()) return;
        setError("Gespräch wegen Inaktivität beendet");
        live.current?.close();
        reset();
      }, IDLE_MS);
    };
    try {
      const l = await connectLive({
        onState: (s) => mine() && (s === "closed" ? reset() : setStatus(s)),
        onUserText: (t) => {
          if (!mine()) return;
          armIdle();
          setUser(t);
          setAssistant("");
        },
        onAssistantText: (t) => mine() && setAssistant(t),
        onWorking: (w) => mine() && setWorking(w),
        onError: (msg) => mine() && setError(msg),
      });
      if (!mine()) return l.close(); // während des Verbindens verworfen (Unmount)
      live.current = l;
      setStreams({ mic: l.micStream, remote: l.remoteStream, audio });
      armIdle();
      void acquire();
    } catch (e) {
      // den Fehlertext hat connectLive schon über onError gemeldet
      if (e instanceof UnauthorizedError) onUnauthorized();
    }
  }

  useEffect(
    () => () => {
      session.current++;
      live.current?.close();
      cleanup();
      release();
    },
    [],
  );

  const active = status === "connected";
  return (
    <main className="relative flex h-full flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <p className="pt-5 text-center text-xs tracking-[0.3em] text-muted-foreground uppercase">
        Assist · <span className={active ? "text-[#9fd8ff]" : undefined}>{STATUS[status]}</span>
      </p>
      <div className="mt-[14vh]">
        <Waveform mode={working ? "working" : active ? "user" : "idle"} micStream={streams.mic} remoteStream={streams.remote} audio={streams.audio} />
      </div>
      <div className="mt-6 min-h-0 flex-1 overflow-hidden">
        <Subtitles user={user} assistant={assistant} />
      </div>
      <p role="alert" className="min-h-10 px-6 pb-3 text-center text-sm text-destructive">
        {error}
      </p>
      <div className="flex justify-center">
        <MicButton active={active} busy={status === "connecting"} onClick={toggle} />
      </div>
    </main>
  );
}
