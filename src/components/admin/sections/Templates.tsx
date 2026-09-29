"use client";

import { useEffect, useRef, useState } from "react";
import { bub } from "@/config/bub";
import { api, ApiError } from "@/lib/client/api";
import { ensureStoryFonts, loadImage, renderStory } from "@/components/story/render";
import { STORY_FIELDS, VIBES, type StoryField, type StoryTemplate, type Vibe } from "@/types";
import { Badge, Btn, Card, Check, Input, Notice, Select, Table, uploadAsset, useApi } from "../ui";

type Form = Omit<StoryTemplate, "created_at" | "updated_at" | "is_placeholder">;

const blank: Form = {
  template_id: "",
  name: "",
  vibe: "SHOPPER",
  active: true,
  sort_order: 10,
  background_asset_url: null,
  overlay_asset_url: null,
  photo_frame: { x: 90, y: 440, w: 900, h: 930 },
  accent_color: bub.brand.colors.orange,
  text_color: bub.brand.colors.black,
  supported_fields: [...STORY_FIELDS],
};

function Preview({ t }: { t: Form }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureStoryFonts();
      const safe = async (u: string | null) => (u ? loadImage(u).catch(() => null) : null);
      const [background, overlay] = await Promise.all([safe(t.background_asset_url), safe(t.overlay_asset_url)]);
      if (cancelled || !ref.current) return;
      renderStory(ref.current, t, { photo: null, photoSize: null, background, overlay }, {
        eventName: bub.event.name,
        dates: `${bub.event.datesShort} ${bub.event.year}`,
        venue: bub.event.venue,
        hashtag: bub.event.hashtag,
        vibe: t.vibe,
        reward: { name: "₹500 Voucher", sponsor_name: "Sample" },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);
  return <canvas ref={ref} width={1080} height={1920} className="w-full border border-bub-line" style={{ aspectRatio: "9/16" }} />;
}

/**
 * Story templates are data, so Media Mileage artwork plugs in without code changes:
 * upload a 1080×1920 background and/or a transparent overlay, set the photo window, and
 * choose which dynamic fields the app should draw on top.
 */
export function Templates() {
  const { data, error, reload } = useApi<{ templates: StoryTemplate[] }>("/api/admin/story-templates");
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const { template_id, ...body } = form;
    try {
      if (editing) await api(`/api/admin/story-templates/${editing}`, { method: "PATCH", body });
      else await api("/api/admin/story-templates", { body: template_id ? form : body });
      setMsg({ kind: "ok", text: "Template saved." });
      setEditing(null);
      setForm(blank);
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  };

  const upload = async (file: File | undefined, key: "background_asset_url" | "overlay_asset_url") => {
    if (!file) return;
    try {
      const url = await uploadAsset(file, "template");
      setForm((f) => ({ ...f, [key]: url }));
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const setFrame = (k: "x" | "y" | "w" | "h", v: string) => setForm((f) => ({ ...f, photo_frame: { ...f.photo_frame, [k]: Number(v) || 0 } }));
  const toggleField = (field: StoryField, on: boolean) => setForm((f) => ({ ...f, supported_fields: on ? [...f.supported_fields, field] : f.supported_fields.filter((x) => x !== field) }));

  return (
    <div className="space-y-6">
      <Card title="Templates">
        {error && <Notice>{error}</Notice>}
        <Table head={["Name", "Vibe", "Assets", "Fields", "Status", ""]} empty={data?.templates.length === 0}>
          {data?.templates.map((t) => (
            <tr key={t.template_id}>
              <td>
                <span className="font-semibold">{t.name}</span> {t.is_placeholder && <Badge>placeholder</Badge>}
                <div className="font-mono text-[11px] text-neutral-400">{t.template_id}</div>
              </td>
              <td>{t.vibe}</td>
              <td className="text-xs">{[t.background_asset_url && "background", t.overlay_asset_url && "overlay"].filter(Boolean).join(" + ") || "built-in design"}</td>
              <td className="max-w-64 text-xs">{t.supported_fields.join(", ")}</td>
              <td>{t.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</td>
              <td>
                <Btn
                  tone="ghost"
                  onClick={() => {
                    const { created_at: _c, updated_at: _u, is_placeholder: _s, ...rest } = t;
                    setEditing(t.template_id);
                    setForm(rest);
                  }}
                >
                  Edit
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-neutral-500">The story page uses the first active template for the chosen vibe (lowest sort order).</p>
      </Card>

      <Card title={editing ? `Edit template — ${editing}` : "New template"}>
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <form onSubmit={submit} className="grid content-start gap-3 md:grid-cols-3">
            <Input label="Template name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="Vibe" value={form.vibe} onChange={(e) => setForm({ ...form, vibe: e.target.value as Vibe })}>
              {VIBES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
            <Input label="Sort order" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
            <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
              <div>
                <Input label="Background asset (1080×1920)" value={form.background_asset_url?.startsWith("data:") ? "(uploaded)" : form.background_asset_url ?? ""} onChange={(e) => setForm({ ...form, background_asset_url: e.target.value || null })} placeholder="URL or upload" />
                <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 text-xs" onChange={(e) => upload(e.target.files?.[0], "background_asset_url")} />
              </div>
              <div>
                <Input label="Overlay asset (transparent PNG)" value={form.overlay_asset_url?.startsWith("data:") ? "(uploaded)" : form.overlay_asset_url ?? ""} onChange={(e) => setForm({ ...form, overlay_asset_url: e.target.value || null })} placeholder="URL or upload" />
                <input type="file" accept="image/png,image/webp" className="mt-1 text-xs" onChange={(e) => upload(e.target.files?.[0], "overlay_asset_url")} />
              </div>
            </div>
            <fieldset className="md:col-span-3">
              <legend className="text-xs font-semibold text-neutral-600">Photo window (px on the 1080×1920 canvas)</legend>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <Input key={k} label={k.toUpperCase()} type="number" value={form.photo_frame[k]} onChange={(e) => setFrame(k, e.target.value)} />
                ))}
              </div>
            </fieldset>
            <Input label="Accent colour" type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value.toUpperCase() })} />
            <Input label="Text colour" type="color" value={form.text_color} onChange={(e) => setForm({ ...form, text_color: e.target.value.toUpperCase() })} />
            <div className="flex items-end">
              <Check label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            </div>
            <fieldset className="md:col-span-3">
              <legend className="text-xs font-semibold text-neutral-600">Dynamic fields drawn by the app</legend>
              <div className="mt-1 flex flex-wrap gap-4">
                {STORY_FIELDS.map((f) => (
                  <Check key={f} label={f} checked={form.supported_fields.includes(f)} onChange={(v) => toggleField(f, v)} />
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2 md:col-span-3">
              <Btn tone="primary" type="submit">
                {editing ? "Save template" : "Create template"}
              </Btn>
              {editing && (
                <Btn
                  type="button"
                  tone="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(blank);
                  }}
                >
                  Cancel
                </Btn>
              )}
            </div>
            {msg && (
              <div className="md:col-span-3">
                <Notice kind={msg.kind}>{msg.text}</Notice>
              </div>
            )}
          </form>
          <div>
            <div className="mb-1 text-xs font-semibold text-neutral-600">Live preview</div>
            <Preview t={form} />
          </div>
        </div>
      </Card>
    </div>
  );
}
