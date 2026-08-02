/**
 * AdminShell — collapsible left sidebar wrapping every /admin/* page.
 *
 * Replaces the old top `<AdminNav />` chip row. Uses the shadcn sidebar so
 * it collapses to icons on desktop and turns into a hamburger sheet on
 * mobile. Only the visual chrome changes — all admin business logic,
 * saved data, and existing routes are untouched.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Settings2,
  ClipboardList,
  Users,
  BookOpen,
  LogOut,
  ChevronDown,
  ChevronRight,
  Search,
  ShieldCheck,
  UserCog,
  Star,
  Megaphone,
  Cog as CogIcon,
} from "lucide-react";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TOOLS } from "@/lib/tools-data";

type NavItem = {
  title: string;
  to: string;
  icon: typeof LayoutDashboard;
  match?: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { title: "Dashboard", to: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Orders", to: "/admin/orders", icon: ClipboardList },
  { title: "Transactions", to: "/admin/transactions", icon: ClipboardList },
  { title: "Access Health", to: "/admin/access-health", icon: ShieldCheck },
  { title: "Awaiting Assignment", to: "/admin/awaiting-assignments", icon: ClipboardList },
];



const CUSTOMER_SUBNAV: { title: string; to: string }[] = [
  { title: "All users", to: "/admin/customers" },
  { title: "Active subscribers", to: "/admin/customers/active" },
  { title: "All-time subscribers", to: "/admin/customers/all-time" },
  { title: "Inactive / expired", to: "/admin/customers/inactive" },
  { title: "New registrations", to: "/admin/customers/new" },
];

const BLOG_SUBNAV: { title: string; to: string; exact?: boolean }[] = [
  { title: "Posts", to: "/admin/blog", exact: true },
  { title: "AI Generator", to: "/admin/blog/ai-generator" },
  { title: "Categories", to: "/admin/blog/categories" },
  { title: "Tags", to: "/admin/blog/tags" },
  { title: "Comments", to: "/admin/blog/comments" },
  { title: "CTAs", to: "/admin/blog/ctas" },
  { title: "Settings", to: "/admin/blog/settings" },
];

const MARKETING_SUBNAV: { title: string; to: string }[] = [
  { title: "All Integrations", to: "/admin/marketing" },
  { title: "Facebook Pixel + Conversions API", to: "/admin/marketing/meta" },
  { title: "Google Tag Manager", to: "/admin/marketing/gtm" },
];

type ReviewsSearch = { status: "all" | "pending" | "approved" | "rejected" | "hidden"; min_rating?: number };
const REVIEWS_SUBNAV: { title: string; search: ReviewsSearch }[] = [
  { title: "Pending", search: { status: "pending" } },
  { title: "Approved", search: { status: "approved" } },
  { title: "Rejected", search: { status: "rejected" } },
  { title: "Hidden", search: { status: "hidden" } },
  { title: "All reviews", search: { status: "all" } },
  { title: "Min rating 3+", search: { status: "all", min_rating: 3 } },
  { title: "Min rating 4+", search: { status: "all", min_rating: 4 } },
  { title: "Min rating 5", search: { status: "all", min_rating: 5 } },
];

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-svh w-full overflow-hidden">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger />
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin
            </span>
            <Link to="/" className="shrink-0 text-xs text-muted-foreground hover:underline">
              View site
            </Link>
          </header>
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}


function AdminSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const reviewsSearch = useRouterState({
    select: (r) => (r.location.search ?? {}) as Record<string, unknown>,
  });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const [toolsOpen, setToolsOpen] = useState(
    () => path.startsWith("/admin/tools"),
  );
  const [customersOpen, setCustomersOpen] = useState(
    () => path.startsWith("/admin/customers"),
  );
  const [blogOpen, setBlogOpen] = useState(
    () => path.startsWith("/admin/blog"),
  );
  const [marketingOpen, setMarketingOpen] = useState(
    () => path.startsWith("/admin/marketing"),
  );
  const [reviewsOpen, setReviewsOpen] = useState(
    () => path.startsWith("/admin/reviews"),
  );
  const [settingsOpen, setSettingsOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("admin.settings.open");
      if (stored !== null) return stored === "1";
    }
    return path.startsWith("/admin/settings") || path.startsWith("/admin/access-health") || path.startsWith("/admin/awaiting-assignments");
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("admin.settings.open", settingsOpen ? "1" : "0");
    }
  }, [settingsOpen]);
  const [q, setQ] = useState("");
  const [myCtx, setMyCtx] = useState<{ isSuperAdmin: boolean; permissions: string[] } | null>(null);
  useEffect(() => {
    getMyAdminContext()
      .then((c) => setMyCtx({ isSuperAdmin: !!c.isSuperAdmin, permissions: c.permissions ?? [] }))
      .catch(() => setMyCtx({ isSuperAdmin: false, permissions: [] }));
  }, []);
  const isSuperAdmin = !!myCtx?.isSuperAdmin;
  const perms = myCtx?.permissions ?? [];
  const can = (p: string) => isSuperAdmin || perms.includes(p);

  const filteredTools = useMemo(
    () =>
      TOOLS.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q.toLowerCase()) ||
          t.category.toLowerCase().includes(q.toLowerCase()),
      ),
    [q],
  );

  const isActive = (item: NavItem) =>
    item.match ? item.match(path) : path === item.to;

  async function signOut() {
    try {
      await supabase.auth.signOut();
      toast.success("Signed out");
      navigate({ to: "/admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign out failed");
    }
  }

  const [healthBadge, setHealthBadge] = useState<{ unresolved: number; awaiting: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mod = await import("@/lib/access-health.functions");
        const res = await mod.getAccessHealthBadgeCounts();
        if (!cancelled) setHealthBadge({ unresolved: res.unresolved, awaiting: res.awaiting });
      } catch {
        /* non-admin or transient — hide the badges */
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            {!collapsed && <span>Admin panel</span>}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={path === "/admin/dashboard"}
                  tooltip="Dashboard"
                >
                  <Link to="/admin/dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Tools — expandable */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/tools")}
                  tooltip="Tools"
                  onClick={() => {
                    if (collapsed) {
                      navigate({ to: "/admin/tools" });
                    } else {
                      setToolsOpen((v) => !v);
                    }
                  }}
                >
                  <Settings2 />
                  <span>Tools</span>
                  {!collapsed &&
                    (toolsOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && toolsOpen && (
                  <>
                    <div className="mx-2 mt-1 flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                      <Search className="h-3 w-3 text-muted-foreground" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search…"
                        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={
                            path === "/admin/tools" || path === "/admin/tools/"
                          }
                        >
                          <Link to="/admin/tools">
                            <span>All tools</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {filteredTools.slice(0, 40).map((t) => (
                        <SidebarMenuSubItem key={t.slug}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={path === `/admin/tools/${t.slug}`}
                          >
                            <Link
                              to="/admin/tools/$slug"
                              params={{ slug: t.slug }}
                            >
                              <span className="truncate">{t.name}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </>
                )}
              </SidebarMenuItem>

              {/* Customers — expandable */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/customers")}
                  tooltip="Customers"
                  onClick={() => {
                    if (collapsed) navigate({ to: "/admin/customers" });
                    else setCustomersOpen((v) => !v);
                  }}
                >
                  <Users />
                  <span>Customers</span>
                  {!collapsed &&
                    (customersOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && customersOpen && (
                  <SidebarMenuSub>
                    {CUSTOMER_SUBNAV.map((s) => (
                      <SidebarMenuSubItem key={s.to}>
                        <SidebarMenuSubButton asChild isActive={path === s.to}>
                          <Link to={s.to}>
                            <span>{s.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>


              {/* Blog — expandable */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/blog")}
                  tooltip="Blog"
                  onClick={() => {
                    if (collapsed) navigate({ to: "/admin/blog" });
                    else setBlogOpen((v) => !v);
                  }}
                >
                  <BookOpen />
                  <span>Blog</span>
                  {!collapsed &&
                    (blogOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && blogOpen && (
                  <SidebarMenuSub>
                    {BLOG_SUBNAV.map((s) => (
                      <SidebarMenuSubItem key={s.to}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={
                            s.exact
                              ? path === s.to || path === `${s.to}/`
                              : path === s.to || path.startsWith(`${s.to}/`)
                          }
                        >
                          <Link to={s.to}>
                            <span>{s.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {/* Marketing — expandable */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/marketing")}
                  tooltip="Integrations"
                  onClick={() => {
                    if (collapsed) navigate({ to: "/admin/marketing" });
                    else setMarketingOpen((v) => !v);
                  }}
                >
                  <Megaphone />
                  <span>Integrations</span>
                  {!collapsed &&
                    (marketingOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && marketingOpen && (
                  <SidebarMenuSub>
                    {MARKETING_SUBNAV.map((s) => (
                      <SidebarMenuSubItem key={s.to}>
                        <SidebarMenuSubButton asChild isActive={path === s.to}>
                          <Link to={s.to}>
                            <span>{s.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {/* Reviews — expandable */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/reviews")}
                  tooltip="Reviews"
                  onClick={() => {
                    if (collapsed) navigate({ to: "/admin/reviews" });
                    else setReviewsOpen((v) => !v);
                  }}
                >
                  <Star />
                  <span>Reviews</span>
                  {!collapsed &&
                    (reviewsOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && reviewsOpen && (
                  <SidebarMenuSub>
                    {REVIEWS_SUBNAV.map((s) => {
                      const activeStatus =
                        (reviewsSearch.status as string | undefined) ?? "pending";
                      const activeMin = Number(reviewsSearch.min_rating ?? 0);
                      const wantMin = Number(s.search.min_rating ?? 0);
                      const isOnReviews = path === "/admin/reviews";
                      const isActiveSub =
                        isOnReviews &&
                        activeStatus === s.search.status &&
                        activeMin === wantMin;
                      return (
                        <SidebarMenuSubItem key={s.title}>
                          <SidebarMenuSubButton asChild isActive={isActiveSub}>
                            <Link to="/admin/reviews" search={s.search}>
                              <span>{s.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {/* Settings — collapsible (Phase 1 foundation) */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={path.startsWith("/admin/settings") || path.startsWith("/admin/access-health") || path.startsWith("/admin/awaiting-assignments")}
                  tooltip="Settings"
                  onClick={() => {
                    if (collapsed) navigate({ to: "/admin/settings" });
                    else setSettingsOpen((v) => !v);
                  }}
                >
                  <CogIcon />
                  <span>Settings</span>
                  {!collapsed && (settingsOpen
                    ? <ChevronDown className="ml-auto h-4 w-4" />
                    : <ChevronRight className="ml-auto h-4 w-4" />)}
                </SidebarMenuButton>
                {!collapsed && settingsOpen && (
                  <SidebarMenuSub>
                    {[
                      { title: "Settings Overview", to: "/admin/settings" as const, perm: null },
                      { title: "Site Appearance & WhatsApp", to: "/admin/appearance" as const, perm: null },
                      { title: "Tool Credentials Vault", to: "/admin/credentials" as const, perm: "credentials.view" },
                      { title: "Access Health", to: "/admin/access-health" as const, perm: null },
                      { title: "Awaiting Assignment", to: "/admin/awaiting-assignments" as const, perm: null },
                      { title: "Promotions & Rewards", to: "/admin/settings/promotions" as const, perm: "promotions.manage" },
                      { title: "Coupons", to: "/admin/settings/coupons" as const, perm: "promotions.manage" },
                      { title: "Email & Notifications", to: "/admin/settings/email" as const, perm: null },
                      { title: "Customer Communications", to: "/admin/settings/communications" as const, perm: "emails.manage" },
                      { title: "Admin Activity", to: "/admin/settings/activity" as const, perm: "audit.view" },
                      { title: "Business Analytics", to: "/admin/settings/analytics" as const, perm: null },

                    ].filter((i) => !i.perm || can(i.perm)).map((i) => (
                      <SidebarMenuSubItem key={i.to}>
                        <SidebarMenuSubButton asChild isActive={path === i.to}>
                          <Link to={i.to}><span>{i.title}</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                    <SidebarMenuSubItem>
                      <div className="mt-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-destructive/70">
                        Critical Controls
                      </div>
                    </SidebarMenuSubItem>
                    {[
                      { title: "Payment Recovery", to: "/admin/settings/payment-recovery" as const, perm: "payments.manage" },
                      { title: "Currency & Surcharge", to: "/admin/settings/currency" as const, perm: "payments.manage" },
                      { title: "API Keys & Providers", to: "/admin/settings/api-keys" as const, perm: "api_keys.manage" },
                      { title: "Staff, Roles & Permissions", to: "/admin/settings/staff" as const, perm: null, superOnly: true },
                      { title: "System Health & Repair", to: "/admin/settings/system-health" as const, perm: "system_health.access" },
                      { title: "Backup & Recovery", to: "/admin/settings/backup" as const, perm: "backups.access" },
                      { title: "Emergency Controls", to: "/admin/settings/emergency" as const, perm: "emergency.use" },
                      { title: "Migration & Launch", to: "/admin/settings/migration" as const, perm: "migration.access" },
                      { title: "Migration Readiness", to: "/admin/settings/migration-readiness" as const, perm: "migration.access" },
                      { title: "Production Readiness", to: "/admin/settings/production-readiness" as const, perm: "system_health.access" },
                      { title: "Migration Guide", to: "/admin/settings/migration-guide" as const, perm: "migration.access" },
                    ].filter((i) => (i.superOnly ? isSuperAdmin : !i.perm || can(i.perm))).map((i) => (
                      <SidebarMenuSubItem key={i.to}>
                        <SidebarMenuSubButton asChild isActive={path === i.to}>
                          <Link to={i.to}><span>{i.title}</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>





              {NAV.filter((n) => n.title !== "Dashboard").map((item) => {
                const badgeCount =
                  item.to === "/admin/access-health"
                    ? healthBadge?.unresolved ?? 0
                    : item.to === "/admin/awaiting-assignments"
                      ? healthBadge?.awaiting ?? 0
                      : 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item)}
                      tooltip={item.title}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.title}</span>
                        {!collapsed && badgeCount > 0 && (
                          <span className="ml-auto inline-flex min-w-[1.25rem] justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {isSuperAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={path === "/admin/admins"}
                    tooltip="Admin management"
                  >
                    <Link to="/admin/admins">
                      <UserCog />
                      <span>Admins</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut} tooltip="Log out">
                  <LogOut />
                  <span>Log out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
