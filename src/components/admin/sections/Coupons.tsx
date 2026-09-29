"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Btn, Card, Input, Notice, Select, Table, fmtDate, useApi } from "../ui";

interface CouponRow {
  coupon_id: string;
  coupon_code: string;
  status: string;
  sponsor_name: string;
  reward_name: string;
  participant_name: string | null;
  participant_phone: string | null;
  issued_at: string;
  claimed_at: string | null;
  redeemed_at: string | null;
  valid_until: string | null;
}

const tone = (s: string) => (s === "REDEEMED" ? "green" : s === "CLAIMED" ? "orange" : s === "EXPIRED" || s === "CANCELLED" ? "red" : "neutral");

export function Coupons() {
  const sponsors = useApi<{ sponsors: Array<{ sponsor_id: string; name: string }> }>("/api/admin/sponsors");
  const [filters, setFilters] = useState({ code: "", participant: "", sponsor_id: "", status: "" });
  const [query, setQuery] = useState("/api/admin/coupons");
  const { data, error, reload } = useApi<{ coupons: CouponRow[] }>(query);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [quick, setQuick] = useState("");

  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    setQuery(`/api/admin/coupons?${p.toString()}`);
  };

  const redeem = async (code: string) => {
    setMsg(null);
    if (!confirm(`Mark ${code} as redeemed? This can't be undone.`)) return;
    try {
      const r = await api<{ coupon: { coupon_code: string; redeemed_at: string } }>(`/api/admin/coupons/${encodeURIComponent(code)}/redeem`, { method: "POST" });
      setMsg({ kind: "ok", text: `${r.coupon.coupon_code} redeemed at ${fmtDate(r.coupon.redeemed_at)}.` });
      setQuick("");
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Redeem at the stall">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void redeem(quick.trim().toUpperCase());
          }}
        >
          <Input label="Coupon code" placeholder="BUB-XXXXXX" value={quick} onChange={(e) => setQuick(e.target.value.toUpperCase())} className="w-56" />
          <Btn tone="primary" type="submit" disabled={quick.trim().length < 10}>
            Mark redeemed
          </Btn>
        </form>
        {msg && (
          <div className="mt-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
      </Card>

      <Card title="Coupons">
        <form onSubmit={search} className="mb-4 grid gap-2 md:grid-cols-5">
          <Input label="Code" value={filters.code} onChange={(e) => setFilters({ ...filters, code: e.target.value })} />
          <Input label="Participant (name or number)" value={filters.participant} onChange={(e) => setFilters({ ...filters, participant: e.target.value })} />
          <Select label="Sponsor" value={filters.sponsor_id} onChange={(e) => setFilters({ ...filters, sponsor_id: e.target.value })}>
            <option value="">All</option>
            {sponsors.data?.sponsors.map((s) => (
              <option key={s.sponsor_id} value={s.sponsor_id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Claimed / redeemed / expired</option>
            {["CLAIMED", "REDEEMED", "EXPIRED", "ISSUED", "CANCELLED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <Btn tone="primary" type="submit" className="w-full justify-center">
              Search
            </Btn>
          </div>
        </form>
        {error && <Notice>{error}</Notice>}
        <Table head={["Code", "Status", "Reward", "Sponsor", "Participant", "Claimed", "Redeemed", "Valid until", ""]} empty={data?.coupons.length === 0}>
          {data?.coupons.map((c) => (
            <tr key={c.coupon_id}>
              <td className="font-mono font-semibold">{c.coupon_code}</td>
              <td>
                <Badge tone={tone(c.status)}>{c.status}</Badge>
              </td>
              <td>{c.reward_name}</td>
              <td className="text-xs">{c.sponsor_name}</td>
              <td className="text-xs">
                {c.participant_name ?? "—"}
                <div className="text-neutral-500">{c.participant_phone}</div>
              </td>
              <td className="text-xs">{fmtDate(c.claimed_at)}</td>
              <td className="text-xs">{fmtDate(c.redeemed_at)}</td>
              <td className="text-xs">{fmtDate(c.valid_until)}</td>
              <td>{c.status === "CLAIMED" && <Btn onClick={() => redeem(c.coupon_code)}>Redeem</Btn>}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
