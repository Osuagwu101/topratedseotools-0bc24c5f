/**
 * Blog image services: AI generation, stock search (Openverse — no key required),
 * uploads to the private `blog-images` bucket, and AI alt-text generation.
 * All mutating fns are admin-gated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "blog-images";
const SIGNED_TTL = 60 * 60 * 24 * 365 * 10; // 10 years

async function assertAdmin(context: { supabase: ReturnType<typeof requireSupabaseAuth> extends { server: (fn: (arg: infer C) => unknown) => unknown } ? C["supabase"] : never; userId: string }) {
  // Simplified: check user_roles directly under RLS
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

async function uploadToBucket(
  supabase: any,
  path: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<{ url: string; path: string }> {
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const { data: signed, error: sErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL);
  if (sErr || !signed?.signedUrl) throw new Error("Failed to sign URL");
  return { url: signed.signedUrl, path };
}

/* ============ AI image generation via Lovable AI Gateway ============ */

export const generateBlogImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().trim().min(3).max(1000),
        model: z.string().default("openai/gpt-image-2"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const isGemini = data.model.startsWith("google/");
    const body: Record<string, unknown> = isGemini
      ? {
          model: data.model,
          messages: [{ role: "user", content: data.prompt }],
          modalities: ["image", "text"],
        }
      : {
          model: data.model,
          prompt: data.prompt,
          size: "1536x1024",
          quality: "low",
          n: 1,
        };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      if (resp.status === 429) throw new Error("Rate limit exceeded, try again in a moment.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      throw new Error(`Image generation failed (${resp.status}): ${t.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned by AI provider");

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `ai/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const out = await uploadToBucket(context.supabase, path, bytes, "image/png");
    return { url: out.url, path: out.path, source: "ai" as const };
  });

/* ============ Stock search via Openverse (public, no key) ============ */

export const searchStockImages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(2).max(200), page: z.number().int().min(1).max(20).default(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const url = new URL("https://api.openverse.org/v1/images/");
    url.searchParams.set("q", data.query);
    url.searchParams.set("page", String(data.page));
    url.searchParams.set("page_size", "18");
    url.searchParams.set("license_type", "commercial");
    url.searchParams.set("mature", "false");
    const resp = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "TopRatedSEOTools-Blog/1.0" },
    });
    if (!resp.ok) {
      throw new Error(`Stock search failed (${resp.status})`);
    }
    const json = (await resp.json()) as {
      results?: Array<{
        id: string;
        title?: string;
        url: string;
        thumbnail?: string;
        creator?: string;
        creator_url?: string;
        license?: string;
        foreign_landing_url?: string;
      }>;
    };
    return {
      results: (json.results ?? []).map((r) => ({
        id: r.id,
        title: r.title ?? "",
        url: r.url,
        thumbnail: r.thumbnail ?? r.url,
        creator: r.creator ?? "",
        creator_url: r.creator_url ?? "",
        license: r.license ?? "",
        source_url: r.foreign_landing_url ?? r.url,
      })),
    };
  });

/* ============ Import a stock image URL into our bucket ============ */

export const importStockImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        url: z.string().url(),
        credit: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const resp = await fetch(data.url);
    if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) throw new Error("URL does not point to an image");
    const buf = await resp.arrayBuffer();
    const ext = ct.split("/")[1]?.split(";")[0] ?? "jpg";
    const path = `stock/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const out = await uploadToBucket(context.supabase, path, buf, ct);
    return { url: out.url, path: out.path, credit: data.credit ?? "", source: "stock" as const };
  });

/* ============ Direct upload (base64 payload from the browser) ============ */

export const uploadBlogImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        filename: z.string().trim().min(1).max(200),
        contentType: z
          .string()
          .regex(/^image\/(png|jpeg|jpg|webp|gif)$/, "Only PNG, JPEG, WEBP, or GIF allowed"),
        base64: z.string().min(10).max(10_000_000), // ~7.5MB decoded
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Image exceeds 5MB limit");
    const ext = (data.contentType.split("/")[1] ?? "png").replace("jpeg", "jpg");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path = `upload/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safeName}.${ext}`;
    const out = await uploadToBucket(context.supabase, path, bytes, data.contentType);
    return { url: out.url, path: out.path, source: "upload" as const };
  });

/* ============ AI alt-text generation (Gemini vision) ============ */

export const generateImageAlt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ imageUrl: z.string().url(), context: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch image, base64-encode inline for the model.
    const imgResp = await fetch(data.imageUrl);
    if (!imgResp.ok) throw new Error("Could not fetch image for alt-text generation");
    const buf = await imgResp.arrayBuffer();
    const mime = imgResp.headers.get("content-type") ?? "image/png";
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf).slice(0, 1_500_000)));

    const systemPrompt =
      "You write concise, descriptive alt text for blog featured images. Output ONE plain sentence, 8-16 words, describing what is visually depicted. No quotes, no 'Image of', no trailing period.";
    const userPrompt = data.context
      ? `Article context: ${data.context}\n\nDescribe the image succinctly.`
      : "Describe the image succinctly.";

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Alt-text generation failed (${resp.status}): ${t.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const alt = json.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "") ?? "";
    return { alt };
  });
