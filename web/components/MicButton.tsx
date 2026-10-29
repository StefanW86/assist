import { cn } from "@/lib/utils";

export function MicButton({ active, busy, onClick }: { active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={active ? "Gespräch beenden" : "Gespräch starten"}
      aria-pressed={active}
      className={cn(
        "relative grid size-20 place-items-center rounded-full border border-accent bg-[rgba(20,60,140,.6)] text-[#cfe3ff] transition-all duration-300 outline-none",
        "shadow-[0_0_18px_rgba(95,176,255,.6)] focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-95 disabled:opacity-70",
        active && "border-[#9fd8ff] bg-[rgba(42,123,255,.55)] shadow-[0_0_28px_rgba(95,176,255,.9),0_0_70px_rgba(42,123,255,.55)]",
      )}
    >
      {(active || busy) && (
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-accent/60 [animation-duration:2.2s] motion-reduce:animate-none" />
      )}
      <svg aria-hidden viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {active ? (
          <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
        ) : (
          <>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </>
        )}
      </svg>
    </button>
  );
}
