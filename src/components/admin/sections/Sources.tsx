"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "@/lib/client/api";
import { bub } from "@/config/bub";
import { Badge, Btn, Card, Input, Notice, Select, Table, fmtDate, useApi } from "../ui";

const TYPES = ["HOARDING", "NEWSPAPER", "NOTICE", "SOCIAL", "OTHER"] as const;

interface SourceRow {
  source_id: string;
  type: (typeof TYPES)[number];
  name: string;
  location: string;
  active: boolean;
  scans: number;
  plays: number;
  leads: number;
  rewards: number;
  qr_url: string;
}

async function downloadQr(s: SourceRow) {
  const url = await QRCode.toDataURL(s.qr_url, { width: 1200, margin: 2, errorCorrectionLevel: "M" });
  const a = document.createElement("a");
  a.href = url;
  a.download = `BUB-QR-${s.source_id}.png`;
  a.click();
}

async function downloadSvg(s: SourceRow) {
  const svg = await QRCode.toString(s.qr_url, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `BUB-QR-${s.source_id}.svg`;
  a.click();
}

interface Visit {
  visit_id: string;
  source_id: string;
  source_type: string;
  location: string;
  session_id: string;
  new_session: boolean;
  created_at: string;
}

function Visits({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const { data, error } = useApi<{ visits: Visit[] }>(`/api/admin/sources/${encodeURIComponent(sourceId)}/visits?limit=100`);
  return (
    <Card title={`Latest QR visits — ${sourceId}`} actions={<Btn tone="ghost" onClick={onClose}>Close</Btn>}>
      <p className="mb-2 text-xs text-bub-muted">Each row is an actual visit through this source&apos;s QR link (not reach).</p>
      {error && <Notice>{error}</Notice>}
      <Table head={["Time", "Type", "Location", "Session", "New session"]} empty={data?.visits.length === 0}>
        {data?.visits.map((v) => (
          <tr key={v.visit_id}>
            <td className="text-xs">{fmtDate(v.created_at)}</td>
            <td>{v.source_type}</td>
            <td>{v.location}</td>
            <td className="font-mono text-[11px]">{v.session_id.slice(0, 8)}…</td>
            <td>{v.new_session ? "yes" : "no"}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export function Sources() {
  const { data, error, reload } = useApi<{ sources: SourceRow[] }>("/api/admin/sources");
  const [form, setForm] = useState({ source_id: "", type: "HOARDING" as SourceRow["type"], name: "", location: "" });
  const [editing, setEditing] = useState<SourceRow | null>(null);
  const [visitsFor, setVisitsFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/api/admin/sources", { body: { ...form, active: true } });
      setMsg({ kind: "ok", text: `Source ${form.source_id.toUpperCase()} created. Download its QR below.` });
      setForm({ source_id: "", type: form.type, name: "", location: "" });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  const save = async (s: SourceRow, patch: Partial<SourceRow>) => {
    setMsg(null);
    try {
      await api(`/api/admin/sources/${encodeURIComponent(s.source_id)}`, { method: "PATCH", body: patch });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  return (
    <div className="space-y-6">
      <Card title="New source / QR">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
          <Input label="Source ID" placeholder="H003" required value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value.toUpperCase() })} />
          <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SourceRow["type"] })}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Input label="Name" placeholder="New Bus Stand" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Location" placeholder={bub.event.city} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <div className="flex items-end">
            <Btn tone="primary" type="submit" className="w-full justify-center">
              Create
            </Btn>
          </div>
        </form>
        <p className="mt-2 text-xs text-neutral-500">Each placement gets its own ID. All QR codes open the same page with ?src=ID so visits are attributed. We report QR scans (visits), never physical reach.</p>
        {msg && (
          <div className="mt-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
      </Card>

      {visitsFor && <Visits sourceId={visitsFor} onClose={() => setVisitsFor(null)} />}
      <Card title="Sources" actions={<Btn onClick={reload}>Refresh</Btn>}>
        {error && <Notice>{error}</Notice>}
        <Table head={["ID", "Type", "Name / location", "Scans", "Plays", "Leads", "Rewards", "Status", "QR", ""]} empty={data?.sources.length === 0}>
          {data?.sources.map((s) =>
            editing?.source_id === s.source_id ? (
              <tr key={s.source_id} className="bg-orange-50">
                <td className="font-mono font-semibold">{s.source_id}</td>
                <td>
                  <Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as SourceRow["type"] })}>
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </td>
                <td colSpan={6} className="space-y-1">
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <Input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
                </td>
                <td colSpan={2} className="space-x-1 whitespace-nowrap">
                  <Btn tone="primary" onClick={() => save(s, { type: editing.type, name: editing.name, location: editing.location })}>
                    Save
                  </Btn>
                  <Btn tone="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Btn>
                </td>
              </tr>
            ) : (
              <tr key={s.source_id}>
                <td className="font-mono font-semibold">{s.source_id}</td>
                <td>{s.type}</td>
                <td>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-neutral-500">{s.location}</div>
                  <div className="font-mono text-[11px] text-neutral-400">{s.qr_url}</div>
                </td>
                <td>{s.scans}</td>
                <td>{s.plays}</td>
                <td>{s.leads}</td>
                <td>{s.rewards}</td>
                <td>
                  <button onClick={() => save(s, { active: !s.active })} title="Toggle active">
                    {s.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}
                  </button>
                </td>
                <td className="whitespace-nowrap">
                  <Btn onClick={() => downloadQr(s)}>PNG</Btn> <Btn onClick={() => downloadSvg(s)}>SVG</Btn>
                </td>
                <td className="whitespace-nowrap">
                  <Btn tone="ghost" onClick={() => setVisitsFor(s.source_id)}>
                    Visits
                  </Btn>
                  <Btn tone="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Btn>
                </td>
              </tr>
            ),
          )}
        </Table>
      </Card>
    </div>
  );
}
