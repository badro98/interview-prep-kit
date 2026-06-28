// Live mic input level — confirms the mic is picking up audio even when Web Speech
// transcription fails (e.g. Cursor's embedded browser, VPN, network blocks).

export default function MicLevelBar({ level = 0, label = "Mic input" }) {
  const active = level > 3;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[11px] text-slate-500">{label}</span>
      <div className="flex h-2 flex-1 gap-0.5 overflow-hidden rounded-full bg-ink-700">
        {Array.from({ length: 24 }, (_, i) => {
          const threshold = (i / 24) * 100;
          const on = level >= threshold;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors duration-75 ${
                on
                  ? i > 18
                    ? "bg-red-400"
                    : i > 12
                    ? "bg-amber-400"
                    : "bg-emerald-400"
                  : "bg-ink-600"
              }`}
            />
          );
        })}
      </div>
      <span
        className={`w-16 shrink-0 text-right text-[11px] ${
          active ? "text-emerald-400" : "text-slate-600"
        }`}
      >
        {active ? "Hearing you" : "Speak…"}
      </span>
    </div>
  );
}
