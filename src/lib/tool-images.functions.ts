/**
 * Tool icon uploads.
 *
 * Icons are normalised in the browser first (square 128×128 WebP, see
 * `src/lib/tool-image-resize.ts`) so every tool icon in the catalogue is the
 * same size and weight. The server only validates and stores the result in the
 * private `tool-images` bucket, returning a long-lived signed URL.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "tool-images";
const SIGNED_TTL = 60 * 60 * 24 * 365 * 10; // 10 years

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const uploadToolIcon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and dashes"),
        contentType: z.string().regex(/^image\/(webp|png|jpeg)$/, "Only WEBP, PNG, or JPEG allowed"),
        // Already-resized icons are tiny; keep a hard ceiling anyway.
        base64: z.string().min(10).max(2_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 1024 * 1024) throw new Error("Icon exceeds 1MB after optimisation");
    const ext = (data.contentType.split("/")[1] ?? "webp").replace("jpeg", "jpg");
    const path = `icons/${data.slug}-${Date.now()}.${ext}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = (context.supabase as any).storage.from(BUCKET);
    const { error: upErr } = await storage.upload(path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: signed, error: sErr } = await storage.createSignedUrl(path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) throw new Error("Failed to sign icon URL");
    return { url: signed.signedUrl as string, path };
  });
