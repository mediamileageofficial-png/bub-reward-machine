"use client";

import { bub } from "@/config/bub";
import { BubLogo, EventMeta, PillarsBand } from "@/components/bub/Brand";
import { BubBox } from "@/components/bub/BubBox";
import { Arrow, ButtonLink } from "@/components/bub/Button";
import { useBubSession, withSrc } from "@/lib/client/session";

export default function LandingPage() {
  const { src, state } = useBubSession();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-hidden bg-bub-bg">
      {state?.mock_mode.whatsapp && (
        <div className="bg-bub-ink py-1 text-center text-[11px] font-semibold uppercase tracking-widest text-bub-white">Demo mode</div>
      )}
      <section className="relative px-5 pb-10 pt-5">
        {bub.brand.heroImageUrl && (
          <div className="absolute inset-0 -z-0">
            <img src={bub.brand.heroImageUrl} alt="" className="h-full w-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-gradient-to-b from-bub-bg/40 via-bub-bg/80 to-bub-bg" />
          </div>
        )}
        <div className="stripes absolute -right-24 top-24 h-72 w-72 rotate-12" aria-hidden />
        <div className="absolute -right-16 bottom-28 h-24 w-[120%] -rotate-6 bg-bub-orange/15" aria-hidden />

        <div className="relative flex items-center justify-between">
          <BubLogo size="md" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-bub-muted">Commercial Expo</span>
        </div>

        <h1 className="font-display relative mt-10 text-[88px] leading-[0.9]">
          <span className="block">Scan.</span>
          <span className="my-1 inline-block -rotate-3 bg-bub-orange px-3 pt-1 text-bub-ink cut-br">Play.</span>
          <span className="block text-bub-orange">Win.</span>
        </h1>

        <div className="relative -mt-3 flex items-end justify-end gap-1" aria-hidden>
          <BubBox className="h-20 w-20 -rotate-6" label="1" />
          <BubBox className="h-24 w-24" label="2" />
          <BubBox className="h-20 w-20 rotate-6" label="3" />
        </div>

        <p className="relative mt-4 max-w-[19rem] text-lg leading-snug text-bub-ink/85">
          Pick your BUB box and win instant rewards from expo sponsors — plus a shot at the <span className="font-semibold text-bub-ink">BUB Lucky Draw</span>.
        </p>

        <div className="relative mt-7">
          <EventMeta />
        </div>

        <div className="relative mt-8">
          {(state?.campaign_status ?? bub.campaign.status) === "live" ? (
            <>
              <ButtonLink href={withSrc("/play", src)} className="min-h-16 text-2xl">
                Play now <Arrow />
              </ButtonLink>
              <p className="mt-3 text-center text-xs text-bub-muted">Takes under a minute · Verify with WhatsApp · No password</p>
            </>
          ) : (
            <div className="border-2 border-bub-ink bg-bub-card px-4 py-4 text-center cut-br">
              <div className="font-display text-2xl">{(state?.campaign_status ?? bub.campaign.status) === "ended" ? "The Reward Machine has closed" : "Back soon"}</div>
              <p className="mt-1 text-sm text-bub-muted">{bub.campaign.statusMessage || "Already won? Your coupon link still works."}</p>
            </div>
          )}
        </div>
      </section>

      <PillarsBand />

      <section className="px-5 py-8">
        <ol className="grid grid-cols-3 gap-2 text-center">
          {[
            ["01", "Pick a box"],
            ["02", "Verify on WhatsApp"],
            ["03", "Show coupon at expo"],
          ].map(([n, t]) => (
            <li key={n} className="border border-bub-line bg-bub-card px-2 py-3 cut-br">
              <div className="font-display text-3xl text-bub-orange">{n}</div>
              <div className="mt-1 text-xs font-semibold uppercase leading-tight tracking-wide">{t}</div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto border-t border-bub-line px-5 py-5 text-[11px] leading-relaxed text-bub-muted">
        {bub.event.name} · {bub.event.datesLabel} · {bub.event.venue}. Organised by {bub.event.organizer}. One play per WhatsApp number.
        {bub.event.termsUrl && (
          <>
            {" "}
            <a href={bub.event.termsUrl} className="underline" target="_blank" rel="noopener noreferrer">
              Terms
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
