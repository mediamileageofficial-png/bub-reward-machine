"use client";

import { useCallback, useEffect, useState } from "react";
import { bub } from "@/config/bub";
import { Shell, Kicker, ErrorNote } from "@/components/bub/Shell";
import { BubBox } from "@/components/bub/BubBox";
import { Arrow, Button, ButtonLink } from "@/components/bub/Button";
import { Field } from "@/components/forms/Field";
import { CouponCard, type CouponView } from "@/components/reward/CouponCard";
import { api, ApiError } from "@/lib/client/api";
import { useBubSession, withSrc } from "@/lib/client/session";
import type { ClaimResponse, PublicCoupon, PublicPlay, SessionState } from "@/lib/client/types";
import type { FlowStep } from "@/components/bub/Progress";

type Stage = "loading" | "pick" | "result" | "details" | "otp" | "claiming" | "done";

const MIN_SHAKE_MS = 1100;

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { ms, label: `${m}:${String(s).padStart(2, "0")}` };
}

export default function PlayPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [play, setPlay] = useState<PublicPlay | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<{ phone_masked: string; mock_hint?: string; resend_after_seconds: number; send_status: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [coupon, setCoupon] = useState<CouponView | null>(null);
  const [claim, setClaim] = useState<ClaimResponse | null>(null);
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCoupon = useCallback(async (couponCode: string, reward?: PublicPlay["reward"]) => {
    try {
      const { coupon: c } = await api<{ coupon: PublicCoupon }>(`/api/coupon/${encodeURIComponent(couponCode)}`);
      setCoupon(c);
    } catch {
      if (reward) setCoupon({ coupon_code: couponCode, status: "CLAIMED", reward_name: reward.name, sponsor_name: reward.sponsor_name });
    }
  }, []);

  const doClaim = useCallback(
    async (sid: string) => {
      setStage("claiming");
      setError(null);
      try {
        const res = await api<ClaimResponse>("/api/reward/claim", { body: { session_id: sid } });
        setClaim(res);
        setPlay(res.play);
        if (res.coupon && res.play.reward) {
          setCoupon({
            coupon_code: res.coupon.coupon_code,
            status: res.coupon.status,
            reward_name: res.play.reward.name,
            sponsor_name: res.play.reward.sponsor_name,
            sponsor_logo_url: res.play.reward.sponsor_logo_url,
            valid_from: res.coupon.valid_from,
            valid_until: res.coupon.valid_until,
          });
        }
        setStage("done");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't claim right now. Please try again.");
        setStage("result");
      }
    },
    [],
  );

  // Resume where the visitor left off (refresh, back button, returning later).
  const resume = useCallback(
    (st: SessionState) => {
      if (!st.play) {
        setStage("pick");
        return;
      }
      setPlay(st.play);
      setPicked(st.play.box_index);
      setOpening(true);
      if (st.play.status === "CLAIMED" || st.participant?.reward_claimed) {
        if (st.participant?.coupon_code) void loadCoupon(st.participant.coupon_code, st.play.reward);
        setStage("done");
      } else if (st.verified) {
        void doClaim(st.session_id);
      } else {
        setStage("result");
      }
    },
    [loadCoupon, doClaim],
  );

  const { state, error: sessionError, src } = useBubSession({ event: "game_started", onReady: resume });
  const sessionId = state?.session_id ?? null;

  const pickBox = async (i: number) => {
    if (!sessionId || picked !== null) return;
    setPicked(i);
    setError(null);
    try {
      const [{ play: p }] = await Promise.all([
        api<{ play: PublicPlay }>("/api/play", { body: { session_id: sessionId, box_index: i } }),
        new Promise((r) => setTimeout(r, MIN_SHAKE_MS)), // let the box shake a moment
      ]);
      setPlay(p);
      setOpening(true);
      setTimeout(() => setStage("result"), 650);
    } catch (e) {
      setPicked(null);
      if (e instanceof ApiError && e.code === "ALREADY_PLAYED") setAlreadyPlayed(true);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    }
  };

  const submitDetails = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/participant", { body: { session_id: sessionId, name, phone } });
      const sent = await api<{ phone_masked: string; mock_hint?: string; resend_after_seconds: number; send_status: string }>("/api/otp/send", { body: { session_id: sessionId } });
      setOtpInfo(sent);
      setResendIn(sent.resend_after_seconds);
      setCode("");
      setStage("otp");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await api<{ phone_masked: string; mock_hint?: string; resend_after_seconds: number; send_status: string }>("/api/otp/send", { body: { session_id: sessionId } });
      setOtpInfo(sent);
      setResendIn(sent.resend_after_seconds);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't resend.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api<{ already_played: boolean }>("/api/otp/verify", { body: { session_id: sessionId, code } });
      setAlreadyPlayed(v.already_played);
      await doClaim(sessionId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const step: FlowStep = stage === "pick" || stage === "loading" ? "Play" : stage === "result" ? "Win" : stage === "done" ? "Coupon" : "Verify";
  const countdown = useCountdown(stage === "result" ? play?.hold_expires_at ?? null : null);
  useEffect(() => {
    if (stage !== "otp") return;
    const t = setInterval(() => setResendIn((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  return (
    <Shell step={step} homeHref={withSrc("/", src)} demo={state?.mock_mode.whatsapp}>
      <ErrorNote>{sessionError}</ErrorNote>

      {stage === "loading" && <div className="flex flex-1 items-center justify-center text-bub-muted">Loading…</div>}

      {stage === "pick" && state && state.campaign_status !== "live" && (
        <section className="flex flex-1 flex-col animate-rise">
          <Kicker>The BUB Reward Machine</Kicker>
          <h1 className="font-display mt-2 text-5xl">{state.campaign_status === "ended" ? "Closed" : "Paused"}</h1>
          <p className="mt-3 text-bub-muted">{bub.campaign.statusMessage || (state.campaign_status === "ended" ? "The Reward Machine has closed. Thank you for playing!" : "The Reward Machine is paused right now. Please check back soon.")}</p>
        </section>
      )}

      {stage === "pick" && state?.campaign_status === "live" && (
        <section className="flex flex-1 flex-col animate-rise">
          <Kicker>The BUB Reward Machine</Kicker>
          <h1 className="font-display mt-2 text-6xl">
            Pick your
            <br />
            <span className="text-bub-orange">BUB box</span>
          </h1>
          <p className="mt-3 text-bub-muted">Three boxes. One is yours. Tap to open it.</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickBox(i)}
                disabled={!sessionId || (picked !== null && picked !== i)}
                aria-label={`Open box ${i + 1}`}
                className="group relative flex flex-col items-center border border-bub-line bg-bub-card px-1 pb-3 pt-4 transition-transform cut-br active:scale-95 disabled:cursor-default"
              >
                <BubBox className="h-24 w-24 transition-transform group-hover:-translate-y-1" label={String(i + 1)} state={picked === i ? (opening ? "open" : "shaking") : picked !== null ? "dim" : "idle"} />
                <span className="font-display mt-2 text-lg">{picked === i ? "Opening…" : `Box ${i + 1}`}</span>
              </button>
            ))}
          </div>
          <div className="mt-6">
            <ErrorNote>{error}</ErrorNote>
            {alreadyPlayed && state?.participant?.coupon_code && (
              <ButtonLink href={withSrc(`/reward?code=${state.participant.coupon_code}`, src)} variant="ghost" className="mt-3">
                View my coupon
              </ButtonLink>
            )}
          </div>
          <p className="mt-auto pt-8 text-center text-xs text-bub-muted">One play per WhatsApp number. Your reward is confirmed after WhatsApp verification.</p>
        </section>
      )}

      {stage === "result" && play && (
        <section className="flex flex-1 flex-col">
          <div className="relative -mx-4 overflow-hidden bg-bub-orange px-4 pb-8 pt-6 text-bub-ink slant-band animate-pop">
            <div className="stripes absolute inset-0 opacity-50" aria-hidden />
            <div className="relative flex items-center gap-3">
              <BubBox className="h-20 w-20 shrink-0" state="open" label={String(play.box_index + 1)} />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em]">{play.outcome === "NONE" ? "Box opened" : "You won"}</div>
                <div className="font-display text-5xl leading-none">{play.outcome === "NONE" ? "So close!" : play.reward?.name}</div>
                {play.reward?.sponsor_name && play.outcome === "REWARD" && <div className="mt-1 text-sm font-semibold">from {play.reward.sponsor_name}</div>}
              </div>
            </div>
          </div>
          <div className="mt-4 animate-rise">
            {play.outcome === "REWARD" && <p className="text-bub-ink/85">{play.reward?.description}</p>}
            {play.outcome === "ENTRY" && <p className="text-bub-ink/85">You&apos;ve unlocked entry to the BUB Lucky Draw. Verify your WhatsApp to lock it in.</p>}
            {play.outcome === "NONE" && <p className="text-bub-ink/85">Today&apos;s rewards are all claimed — verify your WhatsApp to complete the machine and enter the BUB Lucky Draw.</p>}
            {countdown && countdown.ms > 0 && play.outcome === "REWARD" && (
              <p className="mt-4 border-l-4 border-bub-orange pl-3 text-sm">
                Reserved for you for <span className="font-display text-lg text-bub-orange">{countdown.label}</span>. Verify on WhatsApp to claim it.
              </p>
            )}
          </div>
          <div className="mt-auto pt-8">
            <ErrorNote>{error}</ErrorNote>
            <Button className="mt-3" onClick={() => (state?.verified && sessionId ? doClaim(sessionId) : setStage("details"))}>
              {play.outcome === "REWARD" ? "Claim on WhatsApp" : "Continue on WhatsApp"} <Arrow />
            </Button>
          </div>
        </section>
      )}

      {stage === "details" && (
        <form onSubmit={submitDetails} className="flex flex-1 flex-col animate-rise">
          <Kicker>Claim your reward</Kicker>
          <h1 className="font-display mt-2 text-5xl">
            Verify on
            <br />
            <span className="text-bub-orange">WhatsApp</span>
          </h1>
          <p className="mt-3 text-bub-muted">We&apos;ll send a 6-digit code to your WhatsApp. That&apos;s it — no password.</p>
          <div className="mt-6 space-y-4">
            <Field label="Your name" name="name" autoComplete="given-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" />
            <Field label="WhatsApp number" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required prefix="+91" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          </div>
          <p className="mt-3 text-xs text-bub-muted">We only ask for your name and WhatsApp number to deliver your reward and Lucky Draw updates for {bub.event.name}.</p>
          <div className="mt-auto pt-8">
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="mt-3" disabled={busy || !name.trim() || phone.replace(/\D/g, "").length < 10}>
              {busy ? "Sending…" : "Send code"} {!busy && <Arrow />}
            </Button>
            <button type="button" onClick={() => setStage("result")} className="mt-3 w-full py-2 text-sm text-bub-muted underline-offset-4 hover:underline">
              Back
            </button>
          </div>
        </form>
      )}

      {stage === "otp" && otpInfo && (
        <form onSubmit={submitCode} className="flex flex-1 flex-col animate-rise">
          <Kicker>Almost there</Kicker>
          <h1 className="font-display mt-2 text-5xl">
            Enter the
            <br />
            <span className="text-bub-orange">6-digit code</span>
          </h1>
          <p className="mt-3 text-bub-muted">
            {otpInfo.send_status === "ACCEPTED" ? "Code sent via WhatsApp to " : "Code requested for "}
            <span className="font-semibold text-bub-ink">{otpInfo.phone_masked}</span>.
          </p>
          {otpInfo.mock_hint && <p className="mt-3 border border-bub-line bg-bub-card px-3 py-2 text-sm font-semibold text-bub-ink cut-br">{otpInfo.mock_hint}</p>}
          <div className="mt-6">
            <label className="block">
              <span className="sr-only">One-time code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="••••••"
                className="font-display min-h-20 w-full border border-bub-line bg-bub-card text-center text-5xl tracking-[0.4em] text-bub-ink outline-none cut-br placeholder:text-bub-ink/25 focus:outline-2 focus:outline-offset-2 focus:outline-bub-orange"
                aria-label="6-digit code"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setStage("details")} className="text-bub-muted underline-offset-4 hover:underline">
              Change number
            </button>
            <button type="button" onClick={resend} disabled={busy || resendIn > 0} className="font-semibold text-bub-orange disabled:text-bub-muted">
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
          <div className="mt-auto pt-8">
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="mt-3" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Verify & claim"} {!busy && <Arrow />}
            </Button>
          </div>
        </form>
      )}

      {stage === "claiming" && <div className="flex flex-1 items-center justify-center font-display text-3xl text-bub-muted">Unlocking your reward…</div>}

      {stage === "done" && play && (
        <section className="flex flex-1 flex-col animate-rise">
          <Kicker>{alreadyPlayed ? "Welcome back" : "It's yours"}</Kicker>
          <h1 className="font-display mt-2 text-5xl">
            {coupon ? (
              <>
                Your <span className="text-bub-orange">coupon</span>
              </>
            ) : (
              <>
                You&apos;re <span className="text-bub-orange">verified</span>
              </>
            )}
          </h1>
          {alreadyPlayed && <p className="mt-2 text-sm text-bub-muted">This WhatsApp number has already played — here&apos;s your reward.</p>}
          {claim?.reward_changed && !alreadyPlayed && <p className="mt-2 text-sm text-bub-muted">Your reserved box timed out, so the machine picked a fresh reward for you.</p>}

          <div className="mt-5">
            {coupon ? (
              <CouponCard coupon={coupon} />
            ) : (
              <div className="border border-bub-line bg-bub-card p-5 cut-br">
                <div className="font-display text-3xl">{play.reward?.name ?? "Reward Machine complete"}</div>
                <p className="mt-2 text-sm text-bub-muted">Next: enter the BUB Lucky Draw below.</p>
              </div>
            )}
          </div>

          {coupon && claim && (
            <p className="mt-3 text-xs text-bub-muted">
              {claim.whatsapp.status === "ACCEPTED" && "We've asked WhatsApp to send you a copy. Take a screenshot too, just in case."}
              {claim.whatsapp.status === "MOCKED" && "Demo mode: no WhatsApp copy was sent. Take a screenshot of your code."}
              {claim.whatsapp.status === "FAILED" && "We couldn't send a WhatsApp copy right now — please screenshot this coupon."}
              {claim.whatsapp.status === "SKIPPED" && "Screenshot this coupon or save the link to show at the stall."}
            </p>
          )}

          <div className="mt-auto space-y-3 pt-8">
            <ButtonLink href={withSrc("/lucky-draw", src)}>
              Enter the BUB Lucky Draw <Arrow />
            </ButtonLink>
            {coupon && (
              <ButtonLink href={withSrc(`/reward?code=${coupon.coupon_code}`, src)} variant="ghost">
                Open coupon link
              </ButtonLink>
            )}
          </div>
        </section>
      )}
    </Shell>
  );
}
