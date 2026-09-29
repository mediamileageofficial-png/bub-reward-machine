"use client";

import { useState } from "react";
import { bub } from "@/config/bub";
import { Shell, Kicker, ErrorNote } from "@/components/bub/Shell";
import { Arrow, Button, ButtonLink } from "@/components/bub/Button";
import { api, ApiError } from "@/lib/client/api";
import { useBubSession, withSrc } from "@/lib/client/session";

type Key = "bub" | "organizer" | "sponsor";

const ACCOUNTS: Array<{ key: Key; label: string; handle: string; url: string }> = [
  { key: "bub", label: bub.event.shortName, handle: bub.instagram.bub.handle, url: bub.instagram.bub.url },
  { key: "organizer", label: "Organiser", handle: bub.instagram.organizer.handle, url: bub.instagram.organizer.url },
  { key: "sponsor", label: "Title Sponsor", handle: bub.instagram.titleSponsor.handle, url: bub.instagram.titleSponsor.url },
];

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2.2" fill="none" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2.2" fill="none" />
      <circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" />
    </svg>
  );
}

/**
 * Lucky Draw entry. Follows are SELF-CONFIRMED by the participant — V1 does not and cannot
 * verify Instagram follows automatically, and the UI never claims that it does.
 */
export default function LuckyDrawPage() {
  const { state, src, error: sessionError } = useBubSession();
  const [opened, setOpened] = useState<Record<Key, boolean>>({ bub: false, organizer: false, sponsor: false });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ entry_id: string; already_entered: boolean } | null>(null);

  const existingEntry = entry?.entry_id ?? state?.participant?.lucky_draw_entry_id ?? null;
  const canEnter = state?.verified && state.participant?.reward_claimed;

  const submit = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ entry_id: string; already_entered: boolean }>("/api/lucky-draw/enter", {
        body: { session_id: state.session_id, followed_bub: true, followed_organizer: true, followed_sponsor: true },
      });
      setEntry(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't enter right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell step={existingEntry ? "Story" : "Draw"} homeHref={withSrc("/", src)} demo={state?.mock_mode.whatsapp}>
      <ErrorNote>{sessionError}</ErrorNote>
      {!state && !sessionError && <div className="flex flex-1 items-center justify-center text-bub-muted">Loading…</div>}

      {state && existingEntry && (
        <section className="flex flex-1 flex-col animate-rise">
          <Kicker>You&apos;re in</Kicker>
          <h1 className="font-display mt-2 text-6xl">
            Lucky Draw
            <br />
            <span className="text-bub-orange">entered</span>
          </h1>
          <div className="relative mt-6 overflow-hidden bg-bub-orange px-5 py-6 text-bub-ink cut-tl-br animate-pop">
            <div className="stripes absolute inset-0 opacity-60" aria-hidden />
            <div className="relative">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em]">Your Lucky Draw ID</div>
              <div className="font-display mt-1 text-5xl" data-testid="lucky-draw-id">
                {existingEntry}
              </div>
              <div className="mt-2 text-sm font-semibold">Keep this ID. Winners are announced by {bub.event.organizer}.</div>
            </div>
          </div>
          <div className="mt-auto space-y-3 pt-8">
            <ButtonLink href={withSrc("/story", src)}>
              Make my BUB story <Arrow />
            </ButtonLink>
            {state.participant?.coupon_code && (
              <ButtonLink href={withSrc(`/reward?code=${state.participant.coupon_code}`, src)} variant="ghost">
                View my coupon
              </ButtonLink>
            )}
          </div>
        </section>
      )}

      {state && !existingEntry && !canEnter && (
        <section className="flex flex-1 flex-col">
          <Kicker>BUB Lucky Draw</Kicker>
          <h1 className="font-display mt-2 text-5xl">
            Play first to <span className="text-bub-orange">enter</span>
          </h1>
          <p className="mt-3 text-bub-muted">Open your BUB box and verify your WhatsApp number to unlock the Lucky Draw.</p>
          <div className="mt-auto pt-8">
            <ButtonLink href={withSrc("/play", src)}>
              Play now <Arrow />
            </ButtonLink>
          </div>
        </section>
      )}

      {state && !existingEntry && canEnter && (
        <section className="flex flex-1 flex-col animate-rise">
          <Kicker>One last step</Kicker>
          <h1 className="font-display mt-2 text-5xl leading-[0.95]">
            Enter the
            <br />
            <span className="text-bub-orange">BUB Lucky Draw</span>
          </h1>
          <p className="mt-3 text-bub-muted">Follow these 3 accounts on Instagram, then confirm below.</p>

          <ol className="mt-6 space-y-2.5">
            {ACCOUNTS.map((a, i) => (
              <li key={a.key}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpened((o) => ({ ...o, [a.key]: true }))}
                  className="flex min-h-16 items-center gap-3 border border-bub-line bg-bub-card px-4 border border-bub-line cut-br hover:border-bub-orange"
                >
                  <span className="font-display w-7 text-2xl text-bub-orange">{i + 1}</span>
                  <span className="flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-bub-muted">{a.label}</span>
                    <span className="block font-semibold">{a.handle}</span>
                  </span>
                  <span className={`flex items-center gap-1.5 text-sm font-semibold ${opened[a.key] ? "text-bub-ok" : "text-bub-ink"}`}>
                    {opened[a.key] ? "Opened" : "Follow"} <InstagramIcon />
                  </span>
                </a>
              </li>
            ))}
          </ol>

          <label className="mt-6 flex cursor-pointer items-start gap-3 bg-bub-card p-4 border border-bub-line">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-bub-orange" />
            <span>
              <span className="block font-semibold">I&apos;ve followed all 3</span>
              <span className="mt-0.5 block text-xs text-bub-muted">Your confirmation is recorded with your entry. Follows are not checked automatically.</span>
            </span>
          </label>

          <div className="mt-auto pt-8">
            <ErrorNote>{error}</ErrorNote>
            <Button className="mt-3" onClick={submit} disabled={!confirmed || busy}>
              {busy ? "Entering…" : "Enter Lucky Draw"} {!busy && <Arrow />}
            </Button>
          </div>
        </section>
      )}
    </Shell>
  );
}
