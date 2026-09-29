"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Btn, Card, Check, Input, Notice, Table, uploadAsset, useApi } from "../ui";

interface Sponsor {
  sponsor_id: string;
  name: string;
  logo_url: string | null;
  instagram_url: string | null;
  is_title_sponsor: boolean;
  active: boolean;
  is_demo?: boolean;
}

const blank = { name: "", logo_url: "", instagram_url: "", is_title_sponsor: false, active: true };

export function Sponsors() {
  const { data, error, reload } = useApi<{ sponsors: Sponsor[] }>("/api/admin/sponsors");
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (editId) await api(`/api/admin/sponsors/${editId}`, { method: "PATCH", body: form });
      else await api("/api/admin/sponsors", { body: form });
      setMsg({ kind: "ok", text: editId ? "Sponsor updated." : "Sponsor created." });
      setForm(blank);
      setEditId(null);
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  const onLogo = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      setForm((f) => ({ ...f, logo_url: "" }));
      const url = await uploadAsset(file, "logo");
      setForm((f) => ({ ...f, logo_url: url }));
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card title={editId ? "Edit sponsor" : "New sponsor"}>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Input label="Sponsor name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Instagram URL" placeholder="https://www.instagram.com/…" value={form.instagram_url} onChange={(e) => setForm({ ...form, instagram_url: e.target.value })} />
          <div>
            <Input label="Logo URL" placeholder="https://… or upload" value={form.logo_url.startsWith("data:") ? "(uploaded image)" : form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
            <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 text-xs" onChange={(e) => onLogo(e.target.files?.[0])} />
            {uploading && <span className="text-xs text-neutral-500"> Uploading…</span>}
          </div>
          <div className="flex items-center gap-4">
            {form.logo_url && <img src={form.logo_url} alt="" className="h-12 w-12 border object-contain" />}
            <Check label="Title sponsor" checked={form.is_title_sponsor} onChange={(v) => setForm({ ...form, is_title_sponsor: v })} />
            <Check label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Btn tone="primary" type="submit" disabled={uploading}>
              {editId ? "Save" : "Create sponsor"}
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
        {msg && (
          <div className="mt-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
      </Card>
      <Card title="Sponsors">
        {error && <Notice>{error}</Notice>}
        <Table head={["Logo", "Name", "Instagram", "Status", ""]} empty={data?.sponsors.length === 0}>
          {data?.sponsors.map((s) => (
            <tr key={s.sponsor_id}>
              <td>{s.logo_url ? <img src={s.logo_url} alt="" className="h-9 w-9 object-contain" /> : <span className="text-xs text-neutral-400">placeholder</span>}</td>
              <td>
                <span className="font-semibold">{s.name}</span> {s.is_title_sponsor && <Badge tone="orange">title</Badge>} {s.is_demo && <Badge tone="blue">demo</Badge>}
                <div className="font-mono text-[11px] text-neutral-400">{s.sponsor_id}</div>
              </td>
              <td className="max-w-56 truncate text-xs">{s.instagram_url ?? "—"}</td>
              <td>{s.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</td>
              <td>
                <Btn
                  tone="ghost"
                  onClick={() => {
                    setEditId(s.sponsor_id);
                    setForm({ name: s.name, logo_url: s.logo_url ?? "", instagram_url: s.instagram_url ?? "", is_title_sponsor: s.is_title_sponsor, active: s.active });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
