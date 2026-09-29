"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Btn, Card, Check, Input, Notice, Select, Table, fmtDate, isoToLocalInput, localInputToIso, useApi } from "../ui";

interface Reward {
  reward_id: string;
  sponsor_id: string;
  sponsor_name: string;
  name: string;
  description: string;
  type: "VOUCHER" | "FREE_PRODUCT" | "OFFER" | "ENTRY_ONLY";
  total_limit: number | null;
  daily_limit: number | null;
  remaining_inventory: number | null;
  claimed_count: number;
  redeemed_count: number;
  held: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  redeem_from: string | null;
  redeem_until: string | null;
  fallback: boolean;
  weight: number;
  sold_out: boolean;
  is_demo?: boolean;
}

interface FormState {
  sponsor_id: string;
  name: string;
  description: string;
  type: Reward["type"];
  total_limit: string;
  daily_limit: string;
  valid_from: string;
  valid_until: string;
  redeem_from: string;
  redeem_until: string;
  fallback: boolean;
  active: boolean;
  weight: string;
}

const blank: FormState = { sponsor_id: "", name: "", description: "", type: "VOUCHER", total_limit: "", daily_limit: "", valid_from: "", valid_until: "", redeem_from: "", redeem_until: "", fallback: false, active: true, weight: "1" };

function toBody(f: FormState, isEdit: boolean) {
  const unlimited = f.fallback && f.total_limit.trim() === "";
  return {
    sponsor_id: f.sponsor_id,
    name: f.name,
    description: f.description,
    type: f.type,
    ...(isEdit && unlimited ? {} : { total_limit: unlimited ? null : Number(f.total_limit) }),
    daily_limit: f.daily_limit.trim() ? Number(f.daily_limit) : null,
    valid_from: localInputToIso(f.valid_from),
    valid_until: localInputToIso(f.valid_until),
    redeem_from: localInputToIso(f.redeem_from),
    redeem_until: localInputToIso(f.redeem_until),
    fallback: f.fallback,
    active: f.active,
    weight: Number(f.weight || "1"),
  };
}

export function Rewards() {
  const { data, error, reload } = useApi<{ rewards: Reward[] }>("/api/admin/rewards");
  const sponsors = useApi<{ sponsors: Array<{ sponsor_id: string; name: string }> }>("/api/admin/sponsors");
  const [form, setForm] = useState<FormState>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (editId) await api(`/api/admin/rewards/${editId}`, { method: "PATCH", body: toBody(form, true) });
      else await api("/api/admin/rewards", { body: toBody(form, false) });
      setMsg({ kind: "ok", text: editId ? "Reward updated." : "Reward created." });
      setForm(blank);
      setEditId(null);
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  const toggle = async (r: Reward) => {
    try {
      await api(`/api/admin/rewards/${r.reward_id}`, { method: "PATCH", body: { active: !r.active } });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  const edit = (r: Reward) => {
    setEditId(r.reward_id);
    setForm({
      sponsor_id: r.sponsor_id,
      name: r.name,
      description: r.description,
      type: r.type,
      total_limit: r.total_limit === null ? "" : String(r.total_limit),
      daily_limit: r.daily_limit === null ? "" : String(r.daily_limit),
      valid_from: isoToLocalInput(r.valid_from),
      valid_until: isoToLocalInput(r.valid_until),
      redeem_from: isoToLocalInput(r.redeem_from),
      redeem_until: isoToLocalInput(r.redeem_until),
      fallback: r.fallback,
      active: r.active,
      weight: String(r.weight),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <Card title={editId ? "Edit reward" : "New reward"}>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <Select label="Sponsor" required value={form.sponsor_id} onChange={(e) => setForm({ ...form, sponsor_id: e.target.value })}>
            <option value="">Choose…</option>
            {sponsors.data?.sponsors.map((s) => (
              <option key={s.sponsor_id} value={s.sponsor_id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input label="Reward name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Reward["type"] })}>
            <option value="VOUCHER">Voucher (coupon)</option>
            <option value="FREE_PRODUCT">Free product (coupon)</option>
            <option value="OFFER">Offer (coupon)</option>
            <option value="ENTRY_ONLY">Lucky Draw entry only (no coupon)</option>
          </Select>
          <Input label="Selection weight" type="number" min={0} step="0.1" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          <Input label="Description" className="md:col-span-4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label={form.fallback ? "Quantity (blank = unlimited)" : "Quantity"} type="number" min={0} required={!form.fallback} value={form.total_limit} onChange={(e) => setForm({ ...form, total_limit: e.target.value })} />
          <Input label="Daily limit (blank = none)" type="number" min={1} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} />
          <Input label="Winnable from (IST)" type="datetime-local" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
          <Input label="Winnable until (IST)" type="datetime-local" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
          <Input label="Coupon redeemable from (IST)" type="datetime-local" value={form.redeem_from} onChange={(e) => setForm({ ...form, redeem_from: e.target.value })} />
          <Input label="Coupon redeemable until (IST)" type="datetime-local" value={form.redeem_until} onChange={(e) => setForm({ ...form, redeem_until: e.target.value })} />
          <div className="flex items-end gap-4 md:col-span-2">
            <Check label="Fallback reward" checked={form.fallback} onChange={(v) => setForm({ ...form, fallback: v })} />
            <Check label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
          </div>
          <div className="flex gap-2 md:col-span-4">
            <Btn tone="primary" type="submit">
              {editId ? "Save reward" : "Create reward"}
            </Btn>
            {editId && (
              <Btn
                type="button"
                tone="ghost"
                onClick={() => {
                  setEditId(null);
                  setForm(blank);
                }}
              >
                Cancel
              </Btn>
            )}
          </div>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Changing quantity adjusts remaining stock by the same amount and can&apos;t go below what&apos;s already won. Selection chance is proportional to weight × remaining units and is never shown to players. Fallback rewards are used only when nothing else is available.
        </p>
        {msg && (
          <div className="mt-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
      </Card>

      <Card title="Rewards" actions={<Btn onClick={reload}>Refresh</Btn>}>
        {error && <Notice>{error}</Notice>}
        <Table head={["Reward", "Sponsor", "Total", "Claimed", "Held", "Remaining", "Redeemed", "Daily", "Winnable until", "Status", ""]} empty={data?.rewards.length === 0}>
          {data?.rewards.map((r) => (
            <tr key={r.reward_id}>
              <td>
                <span className="font-semibold">{r.name}</span> {r.fallback && <Badge tone="blue">fallback</Badge>} {r.is_demo && <Badge tone="blue">demo</Badge>}
                <div className="text-xs text-neutral-500">{r.type}</div>
              </td>
              <td className="text-xs">{r.sponsor_name}</td>
              <td>{r.total_limit ?? "∞"}</td>
              <td>{r.claimed_count}</td>
              <td title="Won but not yet verified — released after the hold expires">{r.held}</td>
              <td className="font-semibold">{r.remaining_inventory ?? "∞"}</td>
              <td>{r.redeemed_count}</td>
              <td>{r.daily_limit ?? "—"}</td>
              <td className="text-xs">{fmtDate(r.valid_until)}</td>
              <td>{!r.active ? <Badge>paused</Badge> : r.sold_out ? <Badge tone="red">sold out</Badge> : <Badge tone="green">live</Badge>}</td>
              <td className="whitespace-nowrap">
                <Btn onClick={() => toggle(r)}>{r.active ? "Pause" : "Resume"}</Btn> <Btn tone="ghost" onClick={() => edit(r)}>Edit</Btn>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
