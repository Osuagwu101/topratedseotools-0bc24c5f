import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, Sparkles, LogOut, LayoutDashboard, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { to: "/tools", label: "Tools" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
] as const;

export function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all",
        scrolled ? "border-b bg-background/80 backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary text-primary-foreground shadow-glow">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-base tracking-tight">{APP_NAME}</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </Link>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        <button
          className="rounded-md p-2 md:hidden"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t bg-background md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t pt-3">
              {user ? (
                <>
                  <Link
                    to="/dashboard"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </Link>
                  <Link
                    to="/profile"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <UserIcon className="h-4 w-4" /> Profile
                  </Link>
                  <button
                    onClick={() => {
                      setOpen(false);
                      signOut();
                    }}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setOpen(false)}
                    className="rounded-md bg-gradient-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
