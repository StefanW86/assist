import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";

const MESSAGES = {
  wrong: "Kennwort falsch",
  locked: "Zu viele Versuche – bitte später erneut",
  error: "Anmeldung fehlgeschlagen – bitte erneut versuchen",
};

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<keyof typeof MESSAGES | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(password);
      if (result === "ok") return onLogin();
      setError(result);
    } catch {
      setError("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative grid h-full place-items-center px-6">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <h1 className="text-center text-xs tracking-[0.3em] text-muted-foreground uppercase">Assist</h1>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Kennwort"
          aria-label="Kennwort"
          aria-invalid={error !== null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 bg-secondary text-center"
        />
        <Button type="submit" disabled={busy || !password} className="h-11 shadow-[0_0_18px_rgba(95,176,255,.5)]">
          Anmelden
        </Button>
        <p role="alert" className="min-h-5 text-center text-sm text-destructive">
          {error && MESSAGES[error]}
        </p>
      </form>
    </main>
  );
}
