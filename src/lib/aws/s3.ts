import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { AppContext } from "@/lib/context";
import { badRequest } from "@/lib/errors";
import { newId } from "@/lib/ids";

/**
 * Admin brand-asset uploads (sponsor logos, story template artwork).
 * Participant selfies are NEVER uploaded in V1 — stories are rendered on the device.
 *
 * Uses an S3 presigned POST so S3 itself enforces the content type and the maximum size
 * (a presigned PUT cannot limit size). SVG is not accepted (it can carry scripts).
 */
export const ASSET_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);
export const ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const INLINE_ASSET_MAX_BYTES = 2 * 1024 * 1024;

let client: S3Client | null = null;

export async function createAssetUpload(ctx: AppContext, input: { content_type?: unknown; kind?: unknown; size?: unknown }) {
  const ct = typeof input.content_type === "string" ? input.content_type : "";
  const ext = ASSET_TYPES.get(ct);
  if (!ext) throw badRequest("INVALID_FILE_TYPE", "Upload a PNG, JPEG or WebP image.");
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw badRequest("INVALID_FILE_SIZE", "File size is required.");
  const kind = input.kind === "logo" ? "logos" : "templates";

  if (ctx.cfg.awsMockMode || !ctx.cfg.aws.assetsBucket) {
    if (size > INLINE_ASSET_MAX_BYTES) throw badRequest("FILE_TOO_LARGE", "In mock mode images must be under 2 MB.");
    return { mode: "inline" as const, max_bytes: INLINE_ASSET_MAX_BYTES };
  }
  if (size > ASSET_MAX_BYTES) throw badRequest("FILE_TOO_LARGE", "Images must be under 5 MB.");
  client ??= new S3Client({ region: ctx.cfg.aws.region, credentials: ctx.cfg.aws.credentials });
  const key = `${kind}/${newId("ast")}.${ext}`;
  const post = await createPresignedPost(client, {
    Bucket: ctx.cfg.aws.assetsBucket,
    Key: key,
    Conditions: [
      ["content-length-range", 1, ASSET_MAX_BYTES],
      ["eq", "$Content-Type", ct],
    ],
    Fields: { "Content-Type": ct },
    Expires: 300,
  });
  return { mode: "s3" as const, upload_url: post.url, fields: post.fields, public_url: `${ctx.cfg.aws.assetsPublicBaseUrl}/${key}`, max_bytes: ASSET_MAX_BYTES };
}
