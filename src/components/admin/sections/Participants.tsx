"use client";

import { useState } from "react";
import { Btn, Card, Input, Notice, Select, Table, fmtDate, localInputToIso, useApi } from "../ui";

interface Row {
  participant_id: string;
  name: string;
  whatsapp: string;
  source_id: string;
  reward: string | null;
  coupon_code: string | null;
  lucky_draw_entry_id: string | null;
  created_at: string;
}

export function Participants() {
  const rewards = useApi<{ rewards: Array<{ reward_id: string; name: string }> }>("/api/admin/rewards");
  const sources = useApi<{ sources: Array<{ source_id: string; name: string }> }>("/api/admin/sources");
  const [f, setF] = useState({ name: "", whatsapp: "", source: "", reward_id: "", from: "", to: "" });
  const [query, setQuery] = useState("/api/admin/participants");
  const { data, error } = useApi<{ participants: Row[] }>(query);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (f.name) p.set("name", f.name);
    if (f.whatsapp) p.set("whatsapp", f.whatsapp);
    if (f.source) p.set("source", f.source);
    if (f.reward_id) p.set("reward_id", f.reward_id);
    const from = localInputToIso(f.from);
    const to = localInputToIso(f.to);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    setQuery(`/api/admin/participants?${p.toString()}`);
  };

  return (
    <Card title="Participants">
      <form onSubmit={search} className="mb-4 grid gap-2 md:grid-cols-7">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="WhatsApp (full or last 4+)" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
        <Select label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="">All</option>
          <option value="DIRECT">Direct / unknown</option>
          {sources.data?.sources.map((s) => (
            <option key={s.source_id} value={s.source_id}>
              {s.source_id} — {s.name}
            </option>
          ))}
        </Select>
        <Select label="Reward" value={f.reward_id} onChange={(e) => setF({ ...f, reward_id: e.target.value })}>
          <option value="">All</option>
          {rewards.data?.rewards.map((r) => (
            <option key={r.reward_id} value={r.reward_id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Input label="From (IST)" type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input label="To (IST)" type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <div className="flex items-end">
          <Btn tone="primary" type="submit" className="w-full justify-center">
            Filter
          </Btn>
        </div>
      </form>
      <p className="mb-3 text-xs text-neutral-500">Numbers are masked here. Only name and WhatsApp number are collected.</p>
      {error && <Notice>{error}</Notice>}
      <Table head={["Name", "WhatsApp", "Source", "Reward", "Coupon", "Lucky Draw", "Joined"]} empty={data?.participants.length === 0}>
        {data?.participants.map((p) => (
          <tr key={p.participant_id}>
            <td className="font-semibold">{p.name}</td>
            <td className="font-mono text-xs">{p.whatsapp}</td>
            <td className="font-mono text-xs">{p.source_id}</td>
            <td>{p.reward ?? "—"}</td>
            <td className="font-mono text-xs">{p.coupon_code ?? "—"}</td>
            <td className="font-mono text-xs">{p.lucky_draw_entry_id ?? "—"}</td>
            <td className="text-xs">{fmtDate(p.created_at)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
