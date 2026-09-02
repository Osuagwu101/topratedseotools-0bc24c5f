import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Image as ImageIcon, Upload, Loader2, Wand2, X } from "lucide-react";
import {
  generateBlogImage,
  searchStockImages,
  importStockImage,
  uploadBlogImage,
  generateImageAlt,
} from "@/lib/blog-images.functions";

type Tab = "ai" | "stock" | "upload";

export interface FeaturedImageValue {
  url: string;
  alt: string;
  source: "ai" | "stock" | "upload" | "manual";
  credit?: string;
}

export function FeaturedImagePicker({
  value,
  articleTitle,
  onChange,
}: {
  value: { url: string; alt: string; source: string; credit?: string };
  articleTitle?: string;
  onChange: (v: FeaturedImageValue) => void;
}) {
  const [tab, setTab] = useState<Tab>("ai");
  const [prompt, setPrompt] = useState(articleTitle ?? "");
  const [query, setQuery] = useState(articleTitle ?? "");
  const [results, setResults] = useState<
    Array<{
      id: string;
      url: string;
      thumbnail: string;
      creator: string;
      source_url: string;
      license: string;
      title: string;
    }>
  >([]);
  const [manualUrl, setManualUrl] = useState(value.url ?? "");

  const genFn = useServerFn(generateBlogImage);
  const searchFn = useServerFn(searchStockImages);
  const importFn = useServerFn(importStockImage);
  const uploadFn = useServerFn(uploadBlogImage);
  const altFn = useServerFn(generateImageAlt);

  const gen = useMutation({
    mutationFn: () => genFn({ data: { prompt } }),
    onSuccess: async (r: any) => {
      toast.success("Image generated");
      const alt = await autoAlt(r.url);
      onChange({ url: r.url, alt, source: "ai" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const search = useMutation({
    mutationFn: () => searchFn({ data: { query, page: 1 } }),
    onSuccess: (r: any) => setResults(r.results),
    onError: (e: any) => toast.error(e.message ?? "Search failed"),
  });

  const importImg = useMutation({
    mutationFn: (args: { url: string; credit: string }) => importFn({ data: args }),
    onSuccess: async (r: any, args) => {
      toast.success("Image imported");
      const alt = await autoAlt(r.url);
      onChange({ url: r.url, alt, source: "stock", credit: args.credit });
    },
    onError: (e: any) => toast.error(e.message ?? "Import failed"),
  });

  async function autoAlt(url: string): Promise<string> {
    try {
      const r = (await altFn({ data: { imageUrl: url, context: articleTitle } })) as {
        alt: string;
      };
      return r.alt || "";
    } catch {
      return "";
    }
  }

  async function onFileChosen(f: File) {
    if (f.size > 5 * 1024 * 1024) return toast.error("Max 5MB");
    const b64 = await fileToBase64(f);
    try {
      const r = (await uploadFn({
        data: { filename: f.name, contentType: f.type as any, base64: b64 },
      })) as { url: string };
      toast.success("Image uploaded");
      const alt = await autoAlt(r.url);
      onChange({ url: r.url, alt, source: "upload" });
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Featured image
      </h3>

      {value.url && (
        <div className="relative mt-3">
          <img
            src={value.url}
            alt={value.alt || ""}
            className="aspect-[16/9] w-full rounded-md object-cover"
          />
          <button
            type="button"
            onClick={() => onChange({ url: "", alt: "", source: "manual" })}
            className="absolute right-2 top-2 rounded-full bg-background/90 p-1 shadow hover:bg-background"
            aria-label="Clear image"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {value.url && (
        <div className="mt-2 space-y-1.5">
          <input
            value={value.alt}
            onChange={(e) =>
              onChange({ ...value, alt: e.target.value, source: value.source as any })
            }
            placeholder="Alt text (SEO & accessibility)"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              toast.info("Generating alt text…");
              const alt = await autoAlt(value.url);
              if (alt) onChange({ ...value, alt, source: value.source as any });
            }}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <Wand2 className="h-3 w-3" /> Regenerate alt text
          </button>
          {value.credit && (
            <p className="text-[10px] text-muted-foreground">Credit: {value.credit}</p>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-muted/50 p-1">
        {(["ai", "stock", "upload"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "rounded bg-background px-2 py-1 text-xs font-medium shadow-sm"
                : "rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {t === "ai" ? "AI" : t === "stock" ? "Stock" : "Upload"}
          </button>
        ))}
      </div>

      {tab === "ai" && (
        <div className="mt-3 space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Describe the image you want…"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={gen.isPending || prompt.trim().length < 3}
            onClick={() => gen.mutate()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {gen.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate with AI
          </button>
        </div>
      )}

      {tab === "stock" && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search.mutate())}
              placeholder="Search royalty-free images…"
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => search.mutate()}
              disabled={search.isPending || query.trim().length < 2}
              className="rounded-md border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            >
              {search.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          {results.length > 0 && (
            <div className="grid max-h-72 grid-cols-3 gap-1 overflow-auto rounded-md border p-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={importImg.isPending}
                  onClick={() =>
                    importImg.mutate({
                      url: r.url,
                      credit: r.creator ? `${r.creator} via Openverse (${r.license})` : "",
                    })
                  }
                  className="group relative aspect-square overflow-hidden rounded border hover:ring-2 hover:ring-primary"
                  title={r.title}
                >
                  <img
                    src={r.thumbnail}
                    alt={r.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Powered by Openverse · Creative Commons
          </p>
        </div>
      )}

      {tab === "upload" && (
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-4 text-xs text-muted-foreground hover:border-primary/50 hover:bg-muted/30">
            <Upload className="h-4 w-4" />
            <span>Click to upload (PNG/JPG/WEBP, max 5MB)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileChosen(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Paste external URL</summary>
            <div className="mt-2 flex gap-1.5">
              <input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!/^https?:\/\//.test(manualUrl)) return toast.error("Enter a valid URL");
                  const alt = await autoAlt(manualUrl);
                  onChange({ url: manualUrl, alt, source: "manual" });
                }}
                className="rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
              >
                Use
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read failed"));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(f);
  });
}
