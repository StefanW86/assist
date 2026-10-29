import { useEffect, useRef } from "react";
import { pickMode, type WaveMode } from "@/lib/waveMode";

const COLORS: Record<WaveMode, string> = { idle: "#5fb0ff", user: "#6fc3ff", assistant: "#e6f1ff", working: "#5fb0ff" };
const THRESHOLD = 0.015;
const GAIN = 7;
const LINES = [
  { width: 2.5, alpha: 1, k1: 2.2, k2: 3.7, s1: 1.6, s2: 2.3 },
  { width: 1.2, alpha: 0.6, k1: 1.6, k2: 4.4, s1: -1.1, s2: 1.7 },
];

function analyser(ctx: AudioContext, stream?: MediaStream) {
  if (!stream?.getAudioTracks().length) return null;
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an); // nicht an destination: die Wiedergabe macht das <audio> aus live.ts
  return an;
}

function level(an: AnalyserNode | null, buf: Float32Array<ArrayBuffer>) {
  if (!an) return 0;
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

export function Waveform({ mode, micStream, remoteStream }: { mode: WaveMode; micStream?: MediaStream; remoteStream?: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d")!;
    const slow = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.35 : 1;
    const audio = micStream || remoteStream ? new AudioContext() : null;
    // shortcut: iOS kann einen AudioContext ausserhalb der Klick-Geste pausiert lassen (Welle bleibt dann ruhig); falls ja, Context im Klick anlegen.
    void audio?.resume();
    const mic = audio && analyser(audio, micStream);
    const remote = audio && analyser(audio, remoteStream);
    const buf = new Float32Array(1024);
    let amp = 0;
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const t = (now / 1000) * slow;
      const micLevel = level(mic, buf);
      const remoteLevel = level(remote, buf);
      const m = pickMode(micLevel, remoteLevel, modeRef.current === "working", THRESHOLD);
      const target =
        m === "assistant" ? Math.min(1, 0.15 + remoteLevel * GAIN)
        : m === "user" ? Math.min(1, 0.15 + micLevel * GAIN)
        : m === "working" ? 0.28 + 0.14 * Math.sin(t * 2.4)
        : 0.035;
      amp += (target - amp) * 0.12;

      const color = COLORS[m];
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `${color}00`);
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, `${color}00`);
      g.strokeStyle = grad;
      g.shadowColor = color;
      g.shadowBlur = m === "idle" ? 10 + 5 * Math.sin(t * 1.5) : 14 + amp * 18;
      g.lineCap = "round";

      for (const l of LINES) {
        g.globalAlpha = l.alpha;
        g.lineWidth = l.width;
        g.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const u = x / w;
          const env = Math.sin(Math.PI * u) ** 2; // Ränder bleiben flach, die Welle atmet in der Mitte
          const wave = 0.6 * Math.sin(u * l.k1 * 2 * Math.PI + t * l.s1) + 0.4 * Math.sin(u * l.k2 * 2 * Math.PI - t * l.s2);
          const y = h / 2 + env * amp * h * 0.42 * wave;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      void audio?.close();
    };
  }, [micStream, remoteStream]);

  return <canvas ref={canvasRef} aria-hidden className="block h-40 w-full" />;
}
