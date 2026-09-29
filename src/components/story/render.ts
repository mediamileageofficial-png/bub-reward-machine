"use client";

import { bub } from "@/config/bub";
import type { Rect, StoryField, Vibe } from "@/types";

/** Official BUB palette from the central config. */
const P = bub.brand.colors;

export const STORY_W = bub.story.width;
export const STORY_H = bub.story.height;

export interface RenderTemplate {
  photo_frame: Rect;
  accent_color: string;
  text_color: string;
  supported_fields: StoryField[];
  background_asset_url: string | null;
  overlay_asset_url: string | null;
}

export interface StoryAssets {
  photo: CanvasImageSource | null;
  photoSize: { w: number; h: number } | null;
  background?: HTMLImageElement | null;
  overlay?: HTMLImageElement | null;
  bubLogo?: HTMLImageElement | null;
  sponsorLogo?: HTMLImageElement | null;
}

export interface StoryText {
  eventName: string;
  dates: string;
  venue: string;
  hashtag: string;
  vibe: Vibe;
  reward?: { name: string; sponsor_name: string } | null;
}

export const VIBE_COPY: Record<Vibe, { label: string; line: string; lead: string }> = {
  SHOPPER: { label: "Shopper", line: "Here to shop", lead: "I'm a" },
  EXPLORER: { label: "Explorer", line: "Here to discover", lead: "I'm an" },
  DEAL_HUNTER: { label: "Deal Hunter", line: "Here for the deals", lead: "I'm a" },
  EXPERIENCE_SEEKER: { label: "Experience Seeker", line: "Here to experience", lead: "I'm an" },
};

const DISPLAY = "Anton, Impact, 'Arial Narrow', sans-serif";
const SANS = "Archivo, system-ui, sans-serif";

export async function ensureStoryFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.allSettled([document.fonts.load(`120px Anton`), document.fonts.load(`700 40px Archivo`), document.fonts.load(`800 40px Archivo`)]);
}

/** Loads a same-origin or CORS-enabled image so the canvas stays exportable. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith("data:") && !url.startsWith("/")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Decodes a user photo respecting EXIF orientation. The file never leaves the device. */
export async function decodePhoto(file: File): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch {
      /* fall through (e.g. HEIC on some browsers) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function cutPath(ctx: CanvasRenderingContext2D, r: Rect, cut: number) {
  ctx.beginPath();
  ctx.moveTo(r.x + cut, r.y);
  ctx.lineTo(r.x + r.w, r.y);
  ctx.lineTo(r.x + r.w, r.y + r.h - cut);
  ctx.lineTo(r.x + r.w - cut, r.y + r.h);
  ctx.lineTo(r.x, r.y + r.h);
  ctx.lineTo(r.x, r.y + cut);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, r: Rect) {
  const scale = Math.max(r.w / sw, r.h / sh);
  const w = sw * scale;
  const h = sh * scale;
  // Bias toward the top third so faces in selfies stay in frame.
  ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) * 0.3, w, h);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, start: number, font: (s: number) => string) {
  let size = start;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxW && size > 20) {
    size -= 4;
    ctx.font = font(size);
  }
  return size;
}

function drawWordmark(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string, fg: string, text: StoryText) {
  ctx.fillStyle = accent;
  const bw = 250;
  const bh = 128;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y + bh - 26);
  ctx.lineTo(x + bw - 26, y + bh);
  ctx.lineTo(x, y + bh);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = P.black;
  ctx.font = `118px ${DISPLAY}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("BUB", x + 16, y + 116);
  ctx.fillStyle = fg;
  ctx.font = `46px ${DISPLAY}`;
  ctx.fillText("EXPO", x + bw + 16, y + 58);
  ctx.fillStyle = accent;
  ctx.fillText(text.dates.match(/\d{4}/)?.[0] ?? "", x + bw + 16, y + 112);
}

/**
 * Renders a 1080×1920 story. Layer order:
 *  background (asset or built-in BUB placeholder) → photo → overlay asset → dynamic fields.
 * Templates from Media Mileage plug in via background/overlay assets + photo_frame + supported_fields.
 */
export function renderStory(canvas: HTMLCanvasElement, tpl: RenderTemplate, assets: StoryAssets, text: StoryText) {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const accent = tpl.accent_color;
  const fg = tpl.text_color;
  const has = (f: StoryField) => tpl.supported_fields.includes(f);
  const frame = tpl.photo_frame;

  // ---- background ----
  if (assets.background) {
    ctx.drawImage(assets.background, 0, 0, STORY_W, STORY_H);
  } else {
    ctx.fillStyle = P.background;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
    // diagonal stripes, top right
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 18;
    for (let i = -400; i < 900; i += 46) {
      ctx.beginPath();
      ctx.moveTo(620 + i, 0);
      ctx.lineTo(620 + i + 460, 460);
      ctx.stroke();
    }
    ctx.restore();
    // slanted orange band behind the photo
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, frame.y + frame.h * 0.55);
    ctx.lineTo(STORY_W, frame.y + frame.h * 0.35);
    ctx.lineTo(STORY_W, frame.y + frame.h * 0.35 + 260);
    ctx.lineTo(0, frame.y + frame.h * 0.55 + 260);
    ctx.closePath();
    ctx.fill();
    // offset block shadow
    ctx.fillStyle = P.black;
    cutPath(ctx, { x: frame.x + 22, y: frame.y + 22, w: frame.w, h: frame.h }, 60);
    ctx.fill();
  }

  // ---- photo ----
  ctx.save();
  cutPath(ctx, frame, 60);
  ctx.clip();
  if (assets.photo && assets.photoSize) {
    drawCover(ctx, assets.photo, assets.photoSize.w, assets.photoSize.h, frame);
  } else {
    ctx.fillStyle = P.border;
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.fillStyle = P.muted;
    ctx.font = `64px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText("YOUR PHOTO HERE", frame.x + frame.w / 2, frame.y + frame.h / 2);
    ctx.textAlign = "left";
  }
  ctx.restore();
  if (!assets.background) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    cutPath(ctx, frame, 60);
    ctx.stroke();
  }

  // ---- overlay asset ----
  if (assets.overlay) ctx.drawImage(assets.overlay, 0, 0, STORY_W, STORY_H);

  // ---- dynamic fields ----
  const pad = 90;
  if (has("branding")) {
    if (assets.bubLogo) {
      const h = 128;
      const w = (assets.bubLogo.naturalWidth / assets.bubLogo.naturalHeight) * h;
      ctx.drawImage(assets.bubLogo, pad, 80, w, h);
    } else drawWordmark(ctx, pad, 80, accent, fg, text);
  }

  if (has("vibe")) {
    const v = VIBE_COPY[text.vibe];
    ctx.fillStyle = fg;
    ctx.font = `800 34px ${SANS}`;
    ctx.fillText(v.lead.toUpperCase(), pad, 280);
    const size = fitText(ctx, v.label.toUpperCase(), STORY_W - pad * 2, 132, (s) => `${s}px ${DISPLAY}`);
    ctx.fillStyle = accent;
    ctx.fillText(v.label.toUpperCase(), pad, 280 + size * 0.95);
  }

  // reward tag across the photo's lower edge
  if (has("reward") && text.reward) {
    const label = `I WON: ${text.reward.name}`.toUpperCase();
    ctx.font = `64px ${DISPLAY}`;
    const w = Math.min(STORY_W - pad * 2 + 40, ctx.measureText(label).width + 80);
    const y = frame.y + frame.h - 70;
    ctx.save();
    ctx.translate(frame.x - 20, y);
    ctx.rotate(-0.035);
    ctx.fillStyle = P.black;
    ctx.fillRect(0, 0, w, 104);
    ctx.fillStyle = P.white;
    fitText(ctx, label, w - 80, 64, (s) => `${s}px ${DISPLAY}`);
    ctx.fillText(label, 40, 78);
    ctx.restore();
  }

  let y = frame.y + frame.h + 120;
  if (has("vibe")) {
    ctx.fillStyle = fg;
    ctx.font = `800 40px ${SANS}`;
    ctx.fillText(VIBE_COPY[text.vibe].line.toUpperCase() + " @", pad, y);
    y += 20;
  }
  if (has("event_name")) {
    ctx.fillStyle = fg;
    const s = fitText(ctx, text.eventName.toUpperCase(), STORY_W - pad * 2, 104, (n) => `${n}px ${DISPLAY}`);
    y += s;
    ctx.fillText(text.eventName.toUpperCase(), pad, y);
  }
  if (has("dates")) {
    y += 70;
    ctx.fillStyle = accent;
    ctx.font = `60px ${DISPLAY}`;
    ctx.fillText(text.dates.toUpperCase(), pad, y);
  }
  if (has("venue")) {
    y += 56;
    ctx.fillStyle = fg;
    ctx.font = `600 36px ${SANS}`;
    ctx.fillText(text.venue, pad, y);
  }

  if (has("hashtag")) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, STORY_H - 128, STORY_W, 128);
    ctx.fillStyle = P.white;
    ctx.font = `76px ${DISPLAY}`;
    ctx.fillText(text.hashtag.toUpperCase(), pad, STORY_H - 38);
  }

  if (has("sponsor_logo") && assets.sponsorLogo) {
    const h = 110;
    const w = Math.min(260, (assets.sponsorLogo.naturalWidth / assets.sponsorLogo.naturalHeight) * h);
    const x = STORY_W - pad - w;
    const yy = has("hashtag") ? STORY_H - 128 - h - 40 : STORY_H - h - 60;
    ctx.fillStyle = P.white;
    ctx.fillRect(x - 16, yy - 16, w + 32, h + 32);
    ctx.drawImage(assets.sponsorLogo, x, yy, w, h);
  }
}

export function canvasToFile(canvas: HTMLCanvasElement, name = "my-bub-story.jpg"): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(new File([b], name, { type: "image/jpeg" })) : reject(new Error("export failed"))), "image/jpeg", 0.92);
  });
}
