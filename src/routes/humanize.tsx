import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Moon, Sun, Settings2, Sparkles, Wand2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/humanize")({
  head: () => ({
    meta: [
      { title: "HumanizeAI — Make AI Text Sound Human" },
      {
        name: "description",
        content:
          "Paste AI-generated text and rewrite it into natural, human-sounding writing with HumanizeAI, powered by Gemini 1.5 Pro.",
      },
      { property: "og:title", content: "HumanizeAI — AI Text Humanizer" },
      {
        property: "og:description",
        content:
          "Rewrite AI-generated content into natural human writing. Fast, private, and powered by Gemini 1.5 Pro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HumanizePage,
});

const GLASS =
  "bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl";

function HumanizePage() {
  const [dark, setDark] = useState(true);
  const [input, setInput] = useState("");
  const [output] = useState("");

  return (
    <div
      className={cn(
        "min-h-screen transition-colors",
        dark ? "bg-slate-950 text-slate-100" : "bg-slate-100 text-slate-900",
      )}
    >
      {/* Top navigation */}
      <header
        className={cn(
          "sticky top-0 z-40 border-b backdrop-blur-md",
          dark
            ? "border-slate-800 bg-slate-950/80"
            : "border-slate-200 bg-white/80",
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-[0_0_20px_-4px_rgb(139_92_246/0.8)]">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              Humanize<span className="text-violet-400">AI</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Engine status badge */}
            <div
              className={cn(
                "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:inline-flex",
                dark
                  ? "border-slate-800 bg-slate-900/60 text-slate-300"
                  : "border-slate-200 bg-white text-slate-600",
              )}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Engine: Gemini 1.5 Pro
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setDark((d) => !d)}
              className={cn(
                "h-9 w-9 rounded-lg border",
                dark
                  ? "border-slate-800 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
              )}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "h-9 gap-2 rounded-lg border px-3 text-xs font-medium",
                    dark
                      ? "border-slate-800 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline">API Settings</span>
                </Button>
              </SheetTrigger>
              <SheetContent className="border-slate-800 bg-slate-950 text-slate-100">
                <SheetHeader>
                  <SheetTitle className="text-slate-100">API Settings</SheetTitle>
                  <SheetDescription className="text-slate-400">
                    Placeholder panel — wire this up to your provider keys and
                    model options.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="api-key" className="text-slate-300">
                      API key
                    </Label>
                    <Input
                      id="api-key"
                      placeholder="sk-..."
                      className="border-slate-800 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model" className="text-slate-300">
                      Model
                    </Label>
                    <Input
                      id="model"
                      defaultValue="gemini-1.5-pro"
                      className="border-slate-800 bg-slate-900/60 text-slate-100"
                    />
                  </div>
                  <Button className="w-full bg-violet-600 text-white hover:bg-violet-500">
                    Save settings
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Main container */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          AI Humanizer
        </h1>
        <p
          className={cn(
            "mt-2 max-w-2xl text-sm",
            dark ? "text-slate-400" : "text-slate-600",
          )}
        >
          Paste AI-generated text on the left and get natural, human-sounding
          writing on the right.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Input Column */}
          <section
            aria-label="Input Column"
            className={cn(
              "flex flex-col p-5",
              dark
                ? GLASS
                : "rounded-2xl border border-slate-200 bg-white shadow-sm",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                Input Column
              </h2>
              <span
                className={cn(
                  "text-xs",
                  dark ? "text-slate-500" : "text-slate-500",
                )}
              >
                {input.trim() ? input.trim().split(/\s+/).length : 0} words
              </span>
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your AI-generated text here..."
              className={cn(
                "mt-4 min-h-[320px] resize-none text-sm",
                dark
                  ? "border-slate-800 bg-slate-950/60 text-slate-100 placeholder:text-slate-500"
                  : "border-slate-200 bg-white",
              )}
            />
            <Button className="mt-4 gap-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:opacity-90">
              <Wand2 className="h-4 w-4" /> Humanize text
            </Button>
          </section>

          {/* Output Column */}
          <section
            aria-label="Output Column"
            className={cn(
              "flex flex-col p-5",
              dark
                ? GLASS
                : "rounded-2xl border border-slate-200 bg-white shadow-sm",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                Output Column
              </h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={!output}
                onClick={() => navigator.clipboard?.writeText(output)}
                className={cn(
                  "h-7 gap-1.5 px-2 text-xs",
                  dark ? "text-slate-300 hover:bg-slate-800" : "",
                )}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            <div
              className={cn(
                "mt-4 min-h-[320px] rounded-md border p-3 text-sm",
                dark
                  ? "border-slate-800 bg-slate-950/60"
                  : "border-slate-200 bg-slate-50",
              )}
            >
              {output || (
                <span className={dark ? "text-slate-500" : "text-slate-400"}>
                  Humanized output will appear here.
                </span>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
