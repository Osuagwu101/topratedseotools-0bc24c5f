import { Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/site-config";
import logoAsset from "@/assets/logo.png.asset.json";


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
            <img
              src={logoAsset.url}
              alt={`${APP_NAME} logo`}
              width={32}
              height={32}
              className="h-8 w-8 rounded-md object-contain"
            />
            {APP_NAME}
          </Link>

          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            One subscription. Every AI tool you need. Built for creators, teams and builders.
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
          <span>Built for the AI era.</span>
        </div>
      </div>
    </footer>
  );
}
