"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bub } from "@/config/bub";
import { Shell, Kicker, ErrorNote } from "@/components/bub/Shell";
import { Arrow, Button, ButtonLink } from "@/components/bub/Button";
import { api } from "@/lib/client/api";
import { validatePhotoFile } from "@/lib/story/photo";
import { useBubSession, withSrc } from "@/lib/client/session";
import { canvasToFile, decodePhoto, ensureStoryFonts, loadImage, renderStory, VIBE_COPY, type StoryAssets } from "@/components/story/render";
import type { StoryField, Vibe } from "@/types";

interface Template {
  template_id: string;
  name: string;
  vibe: Vibe;
  photo_frame: { x: number; y: number; w: number; h: number };
  accent_color: string;
  text_color: string;
  supported_fields: StoryField[];
  background_asset_url: string | null;
  overlay_asset_url: string | null;
}

const ACCEPT = bub.story.acceptedPhotoTypes.join(",");
const VIBES: Vibe[] = ["SHOPPER", "EXPLORER", "DEAL_HUNTER", "EXPERIENCE_SEEKER"];

async function tryLoad(url: string | null | undefined) {
  if (!url) return null;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

/**
 * /story — Instagram story generator. Everything is composed on the device: the photo is never
 * uploaded or stored. Direct Instagram publishing is intentionally not attempted in V1.
 */
export default function StoryPage() {
  const { state, src } = useBubSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [vibe, setVibe] = useState<Vibe>("SHOPPER");
  const [photo, setPhoto] = useState<{ source: CanvasImageSource; w: number; h: number } | null>(null);
  const [includeReward, setIncludeReward] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"downloaded" | "shared" | null>(null);
  const [showIgHelp, setShowIgHelp] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorded = useRef(new Set<string>());
  const [assets, setAssets] = useState<Omit<StoryAssets, "photo" | "photoSize">>({});

  useEffect(() => {
    api<{ templates: Template[] }>("/api/story/templates")
      .then((r) => setTemplates(r.templates))
      .catch(() => setError("Couldn't load story templates."));
  }, []);

  const template = useMemo(() => templates.find((t) => t.vibe === vibe) ?? templates[0] ?? null, [templates, vibe]);
  const reward = state?.participant?.reward_claimed && state.play?.reward && state.play.outcome === "REWARD" ? state.play.reward : null;

  // Load template/brand/sponsor artwork whenever the template changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureStoryFonts();
      const [background, overlay, bubLogo, sponsorLogo] = await Promise.all([
        tryLoad(template?.background_asset_url),
        tryLoad(template?.overlay_asset_url),
        tryLoad(bub.brand.logoUrl || null),
        tryLoad(reward?.sponsor_logo_url),
      ]);
      if (!cancelled) setAssets({ background, overlay, bubLogo, sponsorLogo });
    })();
    return () => {
      cancelled = true;
    };
  }, [template, reward?.sponsor_logo_url]);

  // Re-render the preview whenever inputs change.
  useEffect(() => {
    if (!template || !canvasRef.current) return;
    renderStory(
      canvasRef.current,
      template,
      { ...assets, photo: photo?.source ?? null, photoSize: photo ? { w: photo.w, h: photo.h } : null },
      {
        eventName: bub.event.name,
        dates: `${bub.event.datesShort} ${bub.event.year}`,
        venue: bub.event.venue,
        hashtag: bub.event.hashtag,
        vibe,
        reward: includeReward && reward ? { name: reward.name, sponsor_name: reward.sponsor_name } : null,
      },
    );
  }, [template, assets, photo, vibe, includeReward, reward]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    const check = await validatePhotoFile(file);
    if (!check.ok) return setError(check.message);
    try {
      setPhoto(await decodePhoto(file));
    } catch {
      setError("We couldn't read that photo. Try a JPG or PNG.");
    }
  };

  const record = useCallback(async () => {
    if (!state || !template) return;
    const key = `${template.template_id}:${vibe}:${photo ? "p" : "n"}`;
    if (recorded.current.has(key)) return;
    recorded.current.add(key);
    await api("/api/story/generate", { body: { session_id: state.session_id, template_id: template.template_id, vibe } }).catch(() => recorded.current.delete(key));
  }, [state, template, vibe, photo]);

  const download = async () => {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const file = await canvasToFile(canvasRef.current);
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone("downloaded");
      void record();
    } catch {
      setError("Couldn't save the image. Try a different photo.");
    } finally {
      setBusy(false);
    }
  };

  /** Native share sheet with the image (WhatsApp / Instagram appear there on most phones). */
  const share = async (target: "whatsapp" | "instagram") => {
    if (!canvasRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const file = await canvasToFile(canvasRef.current);
      const text = `I'm at ${bub.event.name} — ${bub.event.datesLabel}, ${bub.event.venue}. ${bub.event.hashtag}`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        setDone("shared");
        void record();
      } else if (target === "whatsapp") {
        await download();
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      } else {
        await download();
        setShowIgHelp(true);
      }
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setError("Sharing isn't available here — download the image instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell step="Story" homeHref={withSrc("/", src)}>
      <Kicker>{bub.event.hashtag}</Kicker>
      <h1 className="font-display mt-2 text-5xl">
        Make your
        <br />
        <span className="text-bub-orange">BUB story</span>
      </h1>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <label className="font-display flex min-h-14 cursor-pointer items-center justify-center gap-2 bg-bub-orange px-3 text-lg text-bub-ink cut-br">
          <input type="file" accept={ACCEPT} capture="user" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          Take selfie
        </label>
        <label className="font-display flex min-h-14 cursor-pointer items-center justify-center gap-2 bg-bub-ink px-3 text-lg text-bub-white cut-br">
          <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          Upload photo
        </label>
      </div>
      <p className="mt-2 text-xs text-bub-muted">Your photo stays on your phone — it isn&apos;t uploaded or stored.</p>

      <fieldset className="mt-5">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.2em] text-bub-muted">Pick your BUB vibe</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {VIBES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVibe(v)}
              aria-pressed={vibe === v}
              className={`font-display min-h-12 px-2 text-lg cut-br ${vibe === v ? "bg-bub-ink text-bub-white" : "border border-bub-line bg-bub-card text-bub-ink"}`}
            >
              {VIBE_COPY[v].label}
            </button>
          ))}
        </div>
      </fieldset>

      {reward && (
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={includeReward} onChange={(e) => setIncludeReward(e.target.checked)} className="h-5 w-5 accent-bub-orange" />
          Show my reward ({reward.name}) on the story
        </label>
      )}

      <div className="mt-5">
        <div className="relative mx-auto w-full max-w-[300px] overflow-hidden border border-bub-line bg-bub-card shadow-[0_0_0_1px_rgba(255,255,255,0.1)]" style={{ aspectRatio: "9 / 16" }}>
          <canvas ref={canvasRef} width={1080} height={1920} className="h-full w-full" aria-label="Story preview" />
        </div>
        <p className="mt-2 text-center text-xs text-bub-muted">Preview · 1080 × 1920</p>
      </div>

      <div className="mt-6 space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={() => share("instagram")} disabled={busy || !template}>
          Share to Instagram story <Arrow />
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="light" onClick={() => share("whatsapp")} disabled={busy || !template} className="text-lg">
            WhatsApp
          </Button>
          <Button variant="ghost" onClick={download} disabled={busy || !template} className="text-lg">
            Download
          </Button>
        </div>
        {done && <p className="text-center text-sm text-bub-ok">{done === "shared" ? "Shared! Tag BUB when you post." : "Saved to your phone."}</p>}
      </div>

      <details open={showIgHelp} className="mt-6 border border-bub-line bg-bub-card p-4 text-sm border border-bub-line">
        <summary className="cursor-pointer font-semibold">How to post it on Instagram</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-bub-ink/85">
          <li>Tap <b>Share to Instagram story</b> and choose Instagram — or tap <b>Download</b>.</li>
          <li>If you downloaded it: open Instagram, tap <b>+</b>, choose <b>Story</b> and pick the saved image.</li>
          <li>
            Tag {bub.instagram.bub.handle} and add <b>{bub.event.hashtag}</b>.
          </li>
        </ol>
      </details>

      <div className="mt-6">
        <ButtonLink href={withSrc("/", src)} variant="ghost">
          Done
        </ButtonLink>
      </div>
    </Shell>
  );
}
