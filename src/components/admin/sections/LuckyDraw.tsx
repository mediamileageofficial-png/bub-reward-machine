"use client";

import { useState } from "react";
import { bub } from "@/config/bub";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Btn, Card, Input, Notice, Stat, Table, fmtDate, useApi } from "../ui";

interface Draw {
  draw_id: string;
  entry_id: string;
  prize: string;
  status: "SELECTED" | "WINNER" | "REDRAWN";
  redraw_reason: string | null;
  selected_at: string;
  name: string;
  whatsapp: string;
}
interface Data {
  total_entries: number;
  eligible_remaining: number;
  entries: Array<{ entry_id: string; name: string; whatsapp: string; source_id: string; entered_at: string }>;
  draws: Draw[];
}

export function LuckyDraw() {
  const { data, error, reload } = useApi<Data>("/api/admin/lucky-draw");
  const [prize, setPrize] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total entries" value={data?.total_entries ?? "…"} />
        <Stat label="Eligible to draw" value={data?.eligible_remaining ?? "…"} sub="Excludes anyone already drawn" />
      </div>

      <Card
        title="Draw a winner"
        actions={
          <a href={`${bub.api.baseUrl}/api/admin/lucky-draw?format=csv`} className="inline-flex min-h-9 items-center border border-neutral-300 bg-white px-3 text-sm font-semibold hover:border-neutral-500">
            Export CSV
          </a>
        }
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api("/api/admin/lucky-draw/select-winner", { body: { prize } }), "Entry selected at random. Contact them, then confirm or redraw.");
          }}
        >
          <Input label="Prize" placeholder="e.g. Grand Prize" value={prize} onChange={(e) => setPrize(e.target.value)} className="w-72" />
          <Btn tone="primary" type="submit" disabled={busy || !prize.trim()}>
            Select random winner
          </Btn>
        </form>
        <p className="mt-2 text-xs text-neutral-500">Selection is uniform and cryptographically random on the server. Each person can be drawn once.</p>
        {msg && (
          <div className="mt-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
      </Card>

      <Card title="Draws">
        {error && <Notice>{error}</Notice>}
        <Table head={["Prize", "Entry", "Name", "WhatsApp", "Status", "Selected", ""]} empty={data?.draws.length === 0}>
          {data?.draws.map((d) => (
            <tr key={d.draw_id} className={d.status === "REDRAWN" ? "text-neutral-400" : ""}>
              <td className="font-semibold">{d.prize}</td>
              <td className="font-mono">{d.entry_id}</td>
              <td>{d.name}</td>
              <td className="font-mono text-xs">{d.whatsapp}</td>
              <td>
                <Badge tone={d.status === "WINNER" ? "green" : d.status === "SELECTED" ? "orange" : "neutral"}>{d.status}</Badge>
                {d.redraw_reason && <div className="text-[11px]">{d.redraw_reason}</div>}
              </td>
              <td className="text-xs">{fmtDate(d.selected_at)}</td>
              <td className="whitespace-nowrap">
                {d.status === "SELECTED" && (
                  <Btn tone="primary" disabled={busy} onClick={() => run(() => api(`/api/admin/lucky-draw/draws/${d.draw_id}`, { body: { action: "confirm" } }), "Winner confirmed.")}>
                    Confirm winner
                  </Btn>
                )}{" "}
                {d.status !== "REDRAWN" && (
                  <>
                    <Btn
                      disabled={busy}
                      onClick={() => {
                        const p = prompt("Prize for this draw", d.prize);
                        if (p) void run(() => api(`/api/admin/lucky-draw/draws/${d.draw_id}`, { body: { action: "set_prize", prize: p } }), "Prize updated.");
                      }}
                    >
                      Prize
                    </Btn>{" "}
                    <Btn
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        const reason = prompt("Reason for redraw (e.g. unreachable)");
                        if (reason !== null) void run(() => api(`/api/admin/lucky-draw/draws/${d.draw_id}`, { body: { action: "redraw", reason } }), "Redrawn — new entry selected.");
                      }}
                    >
                      Redraw
                    </Btn>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Latest entries">
        <Table head={["Entry ID", "Name", "WhatsApp", "Source", "Entered"]} empty={data?.entries.length === 0}>
          {data?.entries.map((e) => (
            <tr key={e.entry_id}>
              <td className="font-mono font-semibold">{e.entry_id}</td>
              <td>{e.name}</td>
              <td className="font-mono text-xs">{e.whatsapp}</td>
              <td className="font-mono text-xs">{e.source_id}</td>
              <td className="text-xs">{fmtDate(e.entered_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
