const STEPS = ["Play", "Win", "Verify", "Coupon", "Draw", "Story"] as const;
export type FlowStep = (typeof STEPS)[number];

/** Flow progress: PLAY → WIN → VERIFY → COUPON → DRAW → STORY */
export function Progress({ current }: { current: FlowStep }) {
  const idx = STEPS.indexOf(current);
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1" aria-current={i === idx ? "step" : undefined}>
            <div className={`h-1.5 -skew-x-12 ${i < idx ? "bg-bub-orange" : i === idx ? "bg-bub-ink" : "bg-bub-line"}`} />
            <div className={`mt-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] ${i === idx ? "text-bub-ink" : i < idx ? "text-bub-orange" : "text-bub-muted/70"}`}>{s}</div>
          </li>
        ))}
      </ol>
    </nav>
  );
}
