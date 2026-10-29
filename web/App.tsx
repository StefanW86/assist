import { useEffect, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { me } from "@/lib/api";

// Platzhalter, bis Task 8 den echten VoiceScreen liefert.
function VoiceScreen() {
  return <main className="relative grid h-full place-items-center text-muted-foreground">Bereit</main>;
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    me().then(setAuthed, () => setAuthed(false));
  }, []);
  if (authed === null) return null;
  return authed ? <VoiceScreen /> : <LoginScreen onLogin={() => setAuthed(true)} />;
}
