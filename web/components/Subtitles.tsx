export function Subtitles({ user, assistant }: { user: string; assistant: string }) {
  return (
    <div
      aria-live="polite"
      className="mx-auto flex max-w-md flex-col gap-2 px-6 text-center leading-snug [text-shadow:0_1px_3px_rgba(0,0,0,.9),0_0_12px_rgba(2,6,15,.8)]"
    >
      {user && <p className="line-clamp-3 text-[15px] text-[#7fb6ff]">{user}</p>}
      {assistant && <p className="line-clamp-5 text-lg text-[#e6f1ff]">{assistant}</p>}
    </div>
  );
}
