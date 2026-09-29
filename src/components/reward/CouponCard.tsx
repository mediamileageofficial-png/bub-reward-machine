"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { bub, formatEventTime } from "@/config/bub";

export interface CouponView {
  coupon_code: string;
  status: string;
  reward_name: string;
  sponsor_name: string;
  sponsor_logo_url?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  redeemed_at?: string | null;
}

const fmt = (iso?: string | null) => (iso ? formatEventTime(iso) : null);

/** Ticket-style coupon. The QR encodes only the coupon code, for staff lookup at the stall. */
export function CouponCard({ coupon }: { coupon: CouponView }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(coupon.coupon_code, { margin: 1, width: 280, color: { dark: bub.brand.colors.black, light: bub.brand.colors.white } }).then(setQr, () => setQr(null));
  }, [coupon.coupon_code]);

  const status = coupon.status;
  const statusStyle = status === "REDEEMED" ? "bg-bub-ok text-bub-white" : status === "EXPIRED" ? "bg-bub-bad text-bub-white" : "bg-bub-ink text-bub-white";

  return (
    <div className="animate-pop">
      <div className="ticket bg-bub-card text-bub-ink">
        <div className="relative overflow-hidden bg-bub-orange px-5 pb-5 pt-4">
          <div className="stripes absolute inset-0 opacity-60" aria-hidden />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em]">{bub.event.name} · Coupon</div>
              <div className="font-display mt-2 text-4xl leading-none">{coupon.reward_name}</div>
              <div className="mt-1 text-sm font-semibold">{coupon.sponsor_name}</div>
            </div>
            {coupon.sponsor_logo_url && <img src={coupon.sponsor_logo_url} alt="" className="h-12 w-12 bg-white object-contain p-1" />}
          </div>
        </div>
        <div className="border-t-2 border-dashed border-bub-ink/20 px-5 py-5">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-bub-ink/50">Your code</div>
              <div className="font-display mt-1 select-all whitespace-nowrap text-[clamp(26px,8.5vw,40px)] leading-none tracking-wide" data-testid="coupon-code">
                {coupon.coupon_code}
              </div>
              <span className={`mt-3 inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${statusStyle}`}>{status === "CLAIMED" ? "Ready to redeem" : status}</span>
            </div>
            {qr && <img src={qr} alt={`QR code for ${coupon.coupon_code}`} className="h-24 w-24 shrink-0 min-[380px]:h-28 min-[380px]:w-28" />}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {coupon.valid_from && (
              <div>
                <dt className="font-bold uppercase tracking-wider text-bub-ink/50">Valid from</dt>
                <dd className="font-semibold">{fmt(coupon.valid_from)}</dd>
              </div>
            )}
            {coupon.valid_until && (
              <div>
                <dt className="font-bold uppercase tracking-wider text-bub-ink/50">Valid until</dt>
                <dd className="font-semibold">{fmt(coupon.valid_until)}</dd>
              </div>
            )}
            {coupon.redeemed_at && (
              <div className="col-span-2">
                <dt className="font-bold uppercase tracking-wider text-bub-ink/50">Redeemed</dt>
                <dd className="font-semibold">{fmt(coupon.redeemed_at)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-xs text-bub-ink/60">Show this code at the sponsor stall at {bub.event.venue}.</p>
        </div>
      </div>
    </div>
  );
}
