/**
 * Tool icon picker: resizes and compresses the chosen file in the browser to a
 * square 128×128 WebP so every catalogue icon matches the existing brand marks,
 * then stores it and returns the hosted URL.
 */
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";
import { resizeToolIcon, TOOL_ICON_SIZE } from "@/lib/tool-image-resize";
import { uploadToolIcon } from "@/lib/tool-images.functions";

export function ToolIconUpload({
  slug,
  value,
  onChange,
}: {
  slug: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const upload = useServerFn(uploadToolIcon);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    const safeSlug = (slug || "tool").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    setBusy(true);
    try {
      const resized = await resizeToolIcon(file);
      const out = await upload({
        data: { slug: safeSlug || "tool", contentType: resized.contentType, base64: resized.base64 },
      });
      onChange(out.url);
      toast.success(`Icon optimised to ${TOOL_ICON_SIZE}×${TOOL_ICON_SIZE}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {value ? (
        <div className="relative">
          <img src={value} alt="" className="h-12 w-12 rounded-lg border object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            title="Remove icon"
            className="absolute -right-2 -top-2 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <ImagePlus className="h-4 w-4" />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        {busy ? "Optimising…" : value ? "Replace icon" : "Upload icon"}
      </button>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…or paste an image URL"
        maxLength={600}
        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}
