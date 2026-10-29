import { useEffect, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { VoiceScreen } from "@/components/VoiceScreen";
import { me } from "@/lib/api";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    me().then(setAuthed, () => setAuthed(false));
  }, []);
  if (authed === null) return null;
  return authed ? <VoiceScreen onUnauthorized={() => setAuthed(false)} /> : <LoginScreen onLogin={() => setAuthed(true)} />;
}
