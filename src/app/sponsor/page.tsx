"use client";

import { AdminFrame } from "@/components/admin/AdminFrame";
import { Badge, Card, Notice, Stat, Table, fmtDate, useApi } from "@/components/admin/ui";
import { useRequireRole } from "@/lib/client/auth";

interface Inventory {
  totals: { total: number; claimed: number; remaining: number; redeemed: number };
  rewards: Array<{ reward_name: string; active: boolean; total: number | null; claimed: number; remaining: number | null; redeemed: number }>;
}

function SponsorDashboard() {
  const inv = useApi<Inventory>("/api/sponsor/coupons");
  const red = useApi<{ redemptions: Array<{ coupon_code: string; status: string; redeemed_at: string | null }> }>("/api/sponsor/redemptions");
  return (
    <div className="space-y-6">
      <Card title="Coupon inventory">
        {inv.error && <Notice>{inv.error}</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total coupons" value={inv.data?.totals.total ?? "…"} />
          <Stat label="Claimed" value={inv.data?.totals.claimed ?? "…"} />
          <Stat label="Remaining" value={inv.data?.totals.remaining ?? "…"} />
          <Stat label="Redeemed" value={inv.data?.totals.redeemed ?? "…"} />
        </div>
        {inv.data && inv.data.rewards.length > 1 && (
          <div className="mt-4">
            <Table head={["Reward", "Total", "Claimed", "Remaining", "Redeemed"]}>
              {inv.data.rewards.map((r, i) => (
                <tr key={i}>
                  <td className="font-semibold">
                    {r.reward_name} {!r.active && <Badge>paused</Badge>}
                  </td>
                  <td>{r.total ?? "∞"}</td>
                  <td>{r.claimed}</td>
                  <td>{r.remaining ?? "∞"}</td>
                  <td>{r.redeemed}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
      <Card title="Coupon redemptions">
        {red.error && <Notice>{red.error}</Notice>}
        <Table head={["Coupon code", "Status", "Redeemed (IST)"]} empty={red.data?.redemptions.length === 0}>
          {red.data?.redemptions.map((r) => (
            <tr key={r.coupon_code}>
              <td className="font-mono font-semibold">{r.coupon_code}</td>
              <td>
                <Badge tone={r.status === "REDEEMED" ? "green" : r.status === "EXPIRED" ? "red" : "orange"}>{r.status}</Badge>
              </td>
              <td>{fmtDate(r.redeemed_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

/** /sponsor — Cognito group SPONSOR. Data is scoped to the sponsor server-side. */
export default function SponsorPage() {
  const { me, denied } = useRequireRole("SPONSOR", "/sponsor");
  if (denied) {
    return (
      <AdminFrame title="Sponsor">
        <p className="text-sm">This account isn&apos;t a sponsor account. Use “Sign out” above to switch accounts.</p>
      </AdminFrame>
    );
  }
  if (!me) return <AdminFrame title="Sponsor"><p className="text-sm text-neutral-500">Checking access…</p></AdminFrame>;
  return (
    <AdminFrame title="Sponsor" email={me.email} badge={<span className="text-sm font-semibold text-bub-orange">{me.sponsor_name}</span>}>
      <SponsorDashboard />
    </AdminFrame>
  );
}
