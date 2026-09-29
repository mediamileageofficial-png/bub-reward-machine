import Link from "next/link";
import type { ReactNode } from "react";
import { bub } from "@/config/bub";
import { BubLogo } from "./Brand";
import { Progress, type FlowStep } from "./Progress";

/** Public page frame: phone-width column, BUB header, optional progress, footer. */
export function Shell({ children, step, homeHref = "/", demo }: { children: ReactNode; step?: FlowStep; homeHref?: string; demo?: boolean }) {
  return (
    <div className="grain relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-bub-bg">
      {demo && (
        <div className="bg-bub-ink py-1 text-center text-[11px] font-semibold uppercase tracking-widest text-bub-white">Demo mode — no real WhatsApp messages are sent</div>
      )}
      <header className="flex items-center justify-between px-4 pt-4">
        <Link href={homeHref} aria-label={`${bub.event.name} home`}>
          <BubLogo size="sm" />
        </Link>
        <span className="font-display text-sm text-bub-muted">
          {bub.event.datesShort} · <span className="text-bub-orange">{bub.event.city}</span>
        </span>
      </header>
      {step && (
        <div className="px-4 pt-4">
          <Progress current={step} />
        </div>
      )}
      <main className="flex flex-1 flex-col px-4 pb-8 pt-5">{children}</main>
      <footer className="border-t border-bub-line px-4 py-4 text-[11px] leading-relaxed text-bub-muted">
        {bub.event.name} · {bub.event.datesLabel} · {bub.event.venue}. Organised by {bub.event.organizer}.
      </footer>
    </div>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-bub-orange">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="border-l-4 border-bub-bad bg-bub-bad/10 px-3 py-2 text-sm text-bub-ink">
      {children}
    </p>
  );
}
