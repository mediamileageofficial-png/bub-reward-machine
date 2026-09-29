import { bub } from "@/config/bub";

/** BUB wordmark. Placeholder until the supplied logo is set via NEXT_PUBLIC_BUB_LOGO_URL. */
export function BubLogo({ size = "md", tone = "dark" }: { size?: "sm" | "md" | "lg" | "xl"; tone?: "light" | "dark" }) {
  const h = { sm: "h-7", md: "h-9", lg: "h-14", xl: "h-24" }[size];
  if (bub.brand.logoUrl) return <img src={bub.brand.logoUrl} alt={bub.event.shortName} className={`${h} w-auto`} />;
  const text = { sm: "text-2xl", md: "text-3xl", lg: "text-5xl", xl: "text-8xl" }[size];
  return (
    <span className={`inline-flex items-stretch ${h}`} aria-label={bub.event.shortName}>
      <span className={`font-display ${text} flex items-center bg-bub-orange px-2 text-bub-ink cut-br`}>BUB</span>
      <span className={`font-display ${size === "xl" ? "text-3xl" : "text-xs"} flex flex-col justify-center pl-1.5 leading-none ${tone === "light" ? "text-bub-white" : "text-bub-ink"}`}>
        <span>EXPO</span>
        <span className="text-bub-orange">{bub.event.year}</span>
      </span>
    </span>
  );
}

export function PillarsBand({ className = "" }: { className?: string }) {
  const items = [...bub.event.pillars, ...bub.event.pillars, ...bub.event.pillars, ...bub.event.pillars];
  return (
    <div className={`overflow-hidden bg-bub-orange py-2.5 text-bub-ink ${className}`} aria-label={bub.event.pillars.join(", ")}>
      <div className="flex w-max animate-marquee gap-5 whitespace-nowrap" aria-hidden>
        {items.map((p, i) => (
          <span key={i} className="font-display flex items-center gap-5 text-xl">
            {p}
            <span className="inline-block h-2 w-2 rotate-45 bg-bub-ink" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function EventMeta({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-stretch gap-3 ${compact ? "text-sm" : ""}`}>
      <div className="font-display bg-bub-ink px-3 py-2 text-bub-white cut-br">
        <div className={compact ? "text-2xl" : "text-4xl"}>{bub.event.datesShort}</div>
        <div className="text-xs tracking-widest text-bub-orange">{bub.event.year}</div>
      </div>
      <div className="flex flex-col justify-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-bub-orange">Venue</div>
        <div className="font-semibold leading-tight">{bub.event.venueShort}</div>
        <div className="text-sm text-bub-muted">{bub.event.city}</div>
      </div>
    </div>
  );
}
