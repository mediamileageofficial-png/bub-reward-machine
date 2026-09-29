"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Btn, Card, Input, Notice, Stat, Table, useApi } from "../ui";

interface OverviewData {
  stats: Record<string, number>;
  sources: Array<{ source_id: string; type: string; name: string; active: boolean; scans: number; sessions: number; plays: number; leads: number; rewards: number }>;
  inventory: Array<{ reward_id: string; name: string; total: number | null; remaining: number | null; claimed: number; redeemed: number; active: boolean; sold_out: boolean }>;
  mock_mode: { aws: boolean; whatsapp: boolean };
}

const METRICS: Array<[string, string, string?]> = [
  ["qr_scans", "QR scans", "Visits via a QR/source link — not physical reach"],
  ["unique_sessions", "Unique sessions"],
  ["game_plays", "Game plays", "Boxes opened"],
  ["verified_participants", "WhatsApp verified"],
  ["rewards_won", "Rewards won", "Claimed after verification"],
  ["coupons_issued", "Coupons issued"],
  ["coupons_redeemed", "Coupons redeemed"],
  ["lucky_draw_entries", "Lucky Draw entries"],
  ["stories_generated", "Stories generated"],
];

export function Overview() {
  const { data, error, reload } = useApi<OverviewData>("/api/admin/overview");
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const sendTest = async () => {
    setTestResult(null);
    try {
      const r = await api<{ status: string; provider: string; error: string | null }>("/api/admin/whatsapp/test", { body: { phone: testPhone } });
      setTestResult(r.status === "ACCEPTED" ? `Accepted by ${r.provider} (delivery is not confirmed until WhatsApp reports it).` : r.status === "MOCKED" ? "Mock mode: logged, not sent." : `Failed: ${r.error}`);
    } catch (e) {
      setTestResult(e instanceof ApiError ? e.message : "Failed");
    }
  };

  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;
  return (
    <div className="space-y-6">
      {(data.mock_mode.aws || data.mock_mode.whatsapp) && (
        <Notice kind="info">
          {data.mock_mode.aws && "AWS mock mode: data is in memory and resets on restart. "}
          {data.mock_mode.whatsapp && "WhatsApp mock mode: messages are logged, not sent (OTP 123456)."}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {METRICS.map(([k, label, sub]) => (
          <Stat key={k} label={label} value={data.stats[k] ?? 0} sub={sub} />
        ))}
      </div>

      <Card title="By source" actions={<Btn onClick={reload}>Refresh</Btn>}>
        <Table head={["Source", "Type", "Name", "QR scans", "Sessions", "Plays", "Leads", "Rewards", "Scan→lead"]} empty={!data.sources.length}>
          {data.sources.map((s) => (
            <tr key={s.source_id}>
              <td className="font-mono font-semibold">{s.source_id}</td>
              <td>{s.type}</td>
              <td>
                {s.name} {!s.active && <Badge>inactive</Badge>}
              </td>
              <td>{s.scans}</td>
              <td>{s.sessions}</td>
              <td>{s.plays}</td>
              <td>{s.leads}</td>
              <td>{s.rewards}</td>
              <td>{s.scans ? `${Math.round((s.leads / s.scans) * 100)}%` : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Reward inventory">
        <Table head={["Reward", "Total", "Claimed", "Remaining", "Redeemed", "Status"]} empty={!data.inventory.length}>
          {data.inventory.map((r) => (
            <tr key={r.reward_id}>
              <td className="font-semibold">{r.name}</td>
              <td>{r.total ?? "∞"}</td>
              <td>{r.claimed}</td>
              <td>{r.remaining ?? "∞"}</td>
              <td>{r.redeemed}</td>
              <td>{!r.active ? <Badge>paused</Badge> : r.sold_out ? <Badge tone="red">sold out</Badge> : <Badge tone="green">live</Badge>}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="WhatsApp check">
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Send the event-reminder template to" placeholder="98765 43210" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="w-64" />
          <Btn onClick={sendTest} disabled={!testPhone}>
            Send test
          </Btn>
        </div>
        {testResult && <p className="mt-2 text-sm text-neutral-700">{testResult}</p>}
      </Card>
    </div>
  );
}
