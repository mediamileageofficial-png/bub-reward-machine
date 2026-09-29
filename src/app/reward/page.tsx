"use client";

import { useState } from "react";
import { Shell, Kicker, ErrorNote } from "@/components/bub/Shell";
import { Arrow, Button, ButtonLink } from "@/components/bub/Button";
import { Field } from "@/components/forms/Field";
import { CouponCard } from "@/components/reward/CouponCard";
import { api, ApiError } from "@/lib/client/api";
import { useBubSession, withSrc } from "@/lib/client/session";
import type { PublicCoupon } from "@/lib/client/types";

/** /reward?code=BUB-XXXXXX — the participant's coupon (also what the WhatsApp message links to). */
export default function RewardPage() {
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<PublicCoupon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const { coupon: found } = await api<{ coupon: PublicCoupon }>(`/api/coupon/${encodeURIComponent(c.trim().toUpperCase())}`);
      setCoupon(found);
      setCode(found.coupon_code);
      const url = new URL(window.location.href);
      url.searchParams.set("code", found.coupon_code);
      window.history.replaceState(null, "", url.toString());
    } catch (e) {
      setCoupon(null);
      setError(e instanceof ApiError ? e.message : "Couldn't find that coupon.");
    } finally {
      setBusy(false);
    }
  };

  const { src } = useBubSession({
    onReady: () => {
      const c = new URLSearchParams(window.location.search).get("code");
      if (c) void lookup(c);
    },
  });

  return (
    <Shell step="Coupon" homeHref={withSrc("/", src)}>
      <Kicker>BUB coupon</Kicker>
      {coupon ? (
        <>
          <h1 className="font-display mt-2 text-5xl">
            Your <span className="text-bub-orange">reward</span>
          </h1>
          <div className="mt-5">
            <CouponCard coupon={coupon} />
          </div>
          <div className="mt-auto space-y-3 pt-8">
            <ButtonLink href={withSrc("/lucky-draw", src)}>
              Enter the BUB Lucky Draw <Arrow />
            </ButtonLink>
            <ButtonLink href={withSrc("/story", src)} variant="ghost">
              Make my BUB story
            </ButtonLink>
          </div>
        </>
      ) : (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
          }}
        >
          <h1 className="font-display mt-2 text-5xl">
            Find your <span className="text-bub-orange">coupon</span>
          </h1>
          <div className="mt-6">
            <Field label="Coupon code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BUB-XXXXXX" autoCapitalize="characters" maxLength={10} />
          </div>
          <div className="mt-auto pt-8">
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="mt-3" disabled={busy || code.trim().length < 10}>
              {busy ? "Checking…" : "Show coupon"}
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}
