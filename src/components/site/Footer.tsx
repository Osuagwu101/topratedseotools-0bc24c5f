import { Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/site-config";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { openConsentBanner } from "@/components/marketing/ConsentBanner";

const COLS = [
  {
    title: "Product",
    links: [
      { to: "/tools", label: "All tools" },
      { to: "/pricing", label: "Pricing" },
      { to: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/about", label: "About" },
      { to: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { to: "/privacy", label: "Privacy Policy" },
      { to: "/terms", label: "Terms of Service" },
      { to: "/cookies", label: "Cookie Policy" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="col-span-2 md:col-span-1">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <BrandLogo size={32} className="h-8 w-8 rounded-md" />
            {APP_NAME}
          </Link>

          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Individual subscriptions to premium SEO, AI, writing, research, design, and productivity tools — managed in one place.
          </p>
        </div>
        {COLS.map((col) => (
          <div key={col.title}>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {col.title}
            </div>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-sm text-foreground/80 hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openConsentBanner}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cookie preferences
            </button>
            <span aria-hidden>·</span>
            <span>Individual tool subscriptions, one place to manage them.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
