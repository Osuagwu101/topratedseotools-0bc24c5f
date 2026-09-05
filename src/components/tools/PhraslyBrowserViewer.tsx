import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Expand, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { BrowserViewerLaunch } from "@/lib/browser-viewer";

interface Props {
  launch: BrowserViewerLaunch;
  onClose: () => void;
}

export function PhraslyBrowserViewer({ launch, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const expiryLabel = useMemo(
    () => new Date(launch.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    [launch.expiresAt],
  );

  const enterFullscreen = async () => {
    try {
      await containerRef.current?.requestFullscreen?.();
    } catch {
      // Fullscreen support varies on mobile browsers; the viewer remains usable.
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex h-dvh min-h-[420px] w-full flex-col overflow-hidden bg-slate-950 text-white"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-slate-900 px-2.5 shadow-lg sm:px-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white sm:px-3"
          aria-label="Close Phrasly session"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to tools</span>
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold sm:text-base">Phrasly Workspace</div>
          <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-300 sm:text-xs">
            <ShieldCheck className="h-3 w-3" /> Secure session · ends {expiryLabel}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFrameVersion((value) => value + 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Reload browser viewer"
          title="Reload viewer"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={enterFullscreen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Open full screen"
          title="Full screen"
        >
          <Expand className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white sm:inline-flex"
          aria-label="Close Phrasly session"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 bg-slate-950">
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          Connecting securely to Phrasly…
        </div>
        <iframe
          key={frameVersion}
          src={launch.liveUrl}
          title="Phrasly secure browser session"
          className="absolute inset-0 h-full w-full border-0 bg-slate-950"
          allow="autoplay; clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer"
        />
      </main>
    </div>
  );
}
