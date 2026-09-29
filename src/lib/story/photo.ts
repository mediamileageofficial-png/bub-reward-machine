import { bub } from "@/config/bub";

/**
 * Selfie / photo validation for the story generator (runs on the device — the photo is never
 * uploaded). Checks the declared type, the size, and the file's real signature (magic bytes),
 * so a renamed non-image is rejected even if the browser reports an image type.
 */
export type PhotoCheck = { ok: true; type: string } | { ok: false; code: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "NOT_AN_IMAGE"; message: string };

const ACCEPTED = new Set<string>(bub.story.acceptedPhotoTypes);

export function sniffImageType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heic";
  }
  return null;
}

export function checkPhotoMeta(meta: { type: string; size: number }, maxBytes = bub.story.maxPhotoBytes): PhotoCheck {
  if (!meta.size) return { ok: false, code: "EMPTY", message: "That file is empty. Try another photo." };
  if (meta.size > maxBytes) return { ok: false, code: "TOO_LARGE", message: `That photo is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB). Try another.` };
  // Some Android browsers report HEIC/HEIF with an empty type; the signature check decides then.
  if (meta.type && !ACCEPTED.has(meta.type.toLowerCase())) return { ok: false, code: "UNSUPPORTED_TYPE", message: "Please choose a JPG, PNG, WebP or HEIC photo." };
  return { ok: true, type: meta.type };
}

export async function validatePhotoFile(file: Blob & { type: string; size: number }, maxBytes = bub.story.maxPhotoBytes): Promise<PhotoCheck> {
  const meta = checkPhotoMeta(file, maxBytes);
  if (!meta.ok) return meta;
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed) return { ok: false, code: "NOT_AN_IMAGE", message: "That file isn't a photo we can use. Try a JPG or PNG." };
  return { ok: true, type: sniffed };
}
