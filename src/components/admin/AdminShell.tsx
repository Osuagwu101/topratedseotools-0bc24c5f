/**
 * AdminShell — intentionally simple admin navigation.
 *
 * All existing admin routes and backend capabilities remain available. This
 * shell only reduces day-to-day navigation clutter and groups technical tools
 * behind Advanced.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cog as CogIcon,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
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
import { useCatalogRegistration } from "@/hooks/use-catalog-registration";

const FULFILMENT_ITEMS = [
  { title: "Awaiting Assignment", to: "/admin/awaiting-assignments" as const },
  { title: "Access Health", to: "/admin/access-health" as const },
];

const MARKETING_ITEMS = [
  { title: "Promotions", to: "/admin/settings/promotions" as const, perm: "promotions.manage" },
  { title: "Coupons", to: "/admin/settings/coupons" as const, perm: "promotions.manage" },
  { title: "Reviews", to: "/admin/reviews" as const, perm: null },
  { title: "Blog", to: "/admin/blog" as const, perm: null },
  { title: "Integrations", to: "/admin/marketing" as const, perm: null },
];

const SETTINGS_ITEMS = [
  { title: "Site Appearance", to: "/admin/appearance" as const, perm: null, superOnly: false },
  {
    title: "Credentials",
    to: "/admin/credentials" as const,
    perm: "credentials.view",
    superOnly: false,
  },
  {
    title: "Currency & Surcharge",
    to: "/admin/settings/currency" as const,
    perm: "payments.manage",
    superOnly: false,
  },
  {
    title: "Email & Notifications",
    to: "/admin/settings/email" as const,
    perm: null,
    superOnly: false,
  },
  {
    title: "API Keys & Providers",
    to: "/admin/settings/api-keys" as const,
    perm: "api_keys.manage",
    superOnly: false,
  },
  {
    title: "One-Click Browser Login",
    to: "/admin/settings/browser-auth" as const,
    perm: "api_keys.manage",
    superOnly: false,
  },
  {
    title: "Team & Permissions",
    to: "/admin/settings/staff" as const,
    perm: null,
    superOnly: true,
  },
];

const ADVANCED_ITEMS = [
  {
    title: "Payment Recovery",
    to: "/admin/settings/payment-recovery" as const,
    perm: "payments.manage",
  },
  {
    title: "System Health & Repair",
    to: "/admin/settings/system-health" as const,
    perm: "system_health.access",
  },
  { title: "Backup & Recovery", to: "/admin/settings/backup" as const, perm: "backups.access" },
  { title: "Emergency Controls", to: "/admin/settings/emergency" as const, perm: "emergency.use" },
  { title: "Admin Activity", to: "/admin/settings/activity" as const, perm: "audit.view" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  useCatalogRegistration();

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-svh w-full md:h-svh md:overflow-hidden">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b bg-background px-3 md:static md:z-auto">
            <SidebarTrigger />
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin
            </span>
            <Link to="/" className="shrink-0 text-xs text-muted-foreground hover:underline">
              View site
            </Link>
          </header>
          <main className="min-w-0 flex-1 overflow-x-hidden md:overflow-y-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AdminSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();

  const [fulfilmentOpen, setFulfilmentOpen] = useState(
    () => path.startsWith("/admin/awaiting-assignments") || path.startsWith("/admin/access-health"),
  );
  const [marketingOpen, setMarketingOpen] = useState(
    () =>
      path.startsWith("/admin/blog") ||
      path.startsWith("/admin/reviews") ||
      path.startsWith("/admin/marketing") ||
      path.startsWith("/admin/settings/promotions") ||
      path.startsWith("/admin/settings/coupons"),
  );
  const [settingsOpen, setSettingsOpen] = useState(
    () =>
      path.startsWith("/admin/appearance") ||
      path.startsWith("/admin/credentials") ||
      path.startsWith("/admin/settings/currency") ||
      path.startsWith("/admin/settings/email") ||
      path.startsWith("/admin/settings/api-keys") ||
      path.startsWith("/admin/settings/browser-auth") ||
      path.startsWith("/admin/settings/staff"),
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      path.startsWith("/admin/settings/payment-recovery") ||
      path.startsWith("/admin/settings/system-health") ||
      path.startsWith("/admin/settings/backup") ||
      path.startsWith("/admin/settings/emergency") ||
      path.startsWith("/admin/settings/activity"),
  );

  const [myCtx, setMyCtx] = useState<{ isSuperAdmin: boolean; permissions: string[] } | null>(null);
  const [healthBadge, setHealthBadge] = useState<{ unresolved: number; awaiting: number } | null>(
    null,
  );

  useEffect(() => {
    getMyAdminContext()
      .then((c) => setMyCtx({ isSuperAdmin: !!c.isSuperAdmin, permissions: c.permissions ?? [] }))
      .catch(() => setMyCtx({ isSuperAdmin: false, permissions: [] }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mod = await import("@/lib/access-health.functions");
        const res = await mod.getAccessHealthBadgeCounts();
        if (!cancelled) setHealthBadge({ unresolved: res.unresolved, awaiting: res.awaiting });
      } catch {
        // Hide operational badges when unavailable.
      }
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const isSuperAdmin = !!myCtx?.isSuperAdmin;
  const perms = myCtx?.permissions ?? [];
  const can = (permission: string | null) =>
    !permission || isSuperAdmin || perms.includes(permission);

  async function signOut() {
    try {
      await supabase.auth.signOut();
      toast.success("Signed out");
      navigate({ to: "/admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign out failed");
    }
  }

  const badge = (count: number) =>
    !collapsed && count > 0 ? (
      <span className="ml-auto inline-flex min-w-[1.25rem] justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            {!collapsed && <span>Admin</span>}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SimpleItem
                to="/admin/dashboard"
                title="Dashboard"
                icon={LayoutDashboard}
                active={path === "/admin/dashboard"}
              />
              <SimpleItem
                to="/admin/tools"
                title="Tools"
                icon={Settings2}
                active={path.startsWith("/admin/tools")}
              />
              <SimpleItem
                to="/admin/customers"
                title="Customers"
                icon={Users}
                active={path.startsWith("/admin/customers")}
              />
              <SimpleItem
                to="/admin/orders"
                title="Orders"
                icon={ClipboardList}
                active={path === "/admin/orders"}
              />
              <SimpleItem
                to="/admin/transactions"
                title="Transactions"
                icon={CreditCard}
                active={path === "/admin/transactions"}
              />
              {can("payments.manage") && (
                <SimpleItem
                  to="/admin/settings/custom-payments"
                  title="Custom Payments"
                  icon={CreditCard}
                  active={path === "/admin/settings/custom-payments"}
                />
              )}

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={FULFILMENT_ITEMS.some((i) => path === i.to)}
                  tooltip="Fulfilment"
                  onClick={() =>
                    collapsed
                      ? navigate({ to: "/admin/awaiting-assignments" })
                      : setFulfilmentOpen((v) => !v)
                  }
                >
                  <PackageCheck />
                  <span>Fulfilment</span>
                  {!collapsed &&
                    badge((healthBadge?.awaiting ?? 0) + (healthBadge?.unresolved ?? 0))}
                  {!collapsed &&
                    (fulfilmentOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && fulfilmentOpen && (
                  <SidebarMenuSub>
                    {FULFILMENT_ITEMS.map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton asChild isActive={path === item.to}>
                          <Link to={item.to}>
                            <span>{item.title}</span>
                            {item.to === "/admin/awaiting-assignments"
                              ? badge(healthBadge?.awaiting ?? 0)
                              : badge(healthBadge?.unresolved ?? 0)}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={
                    path.startsWith("/admin/blog") ||
                    path.startsWith("/admin/reviews") ||
                    path.startsWith("/admin/marketing") ||
                    path.startsWith("/admin/settings/promotions") ||
                    path.startsWith("/admin/settings/coupons")
                  }
                  tooltip="Marketing"
                  onClick={() =>
                    collapsed ? navigate({ to: "/admin/marketing" }) : setMarketingOpen((v) => !v)
                  }
                >
                  <Megaphone />
                  <span>Marketing</span>
                  {!collapsed &&
                    (marketingOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && marketingOpen && (
                  <SidebarMenuSub>
                    {MARKETING_ITEMS.filter((item) => can(item.perm)).map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={path === item.to || path.startsWith(`${item.to}/`)}
                        >
                          <Link to={item.to}>
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={
                    path.startsWith("/admin/appearance") ||
                    path.startsWith("/admin/credentials") ||
                    path.startsWith("/admin/settings/currency") ||
                    path.startsWith("/admin/settings/email") ||
                    path.startsWith("/admin/settings/api-keys") ||
                    path.startsWith("/admin/settings/browser-auth") ||
                    path.startsWith("/admin/settings/staff")
                  }
                  tooltip="Settings"
                  onClick={() =>
                    collapsed ? navigate({ to: "/admin/appearance" }) : setSettingsOpen((v) => !v)
                  }
                >
                  <CogIcon />
                  <span>Settings</span>
                  {!collapsed &&
                    (settingsOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && settingsOpen && (
                  <SidebarMenuSub>
                    {SETTINGS_ITEMS.filter(
                      (item) => (!item.superOnly || isSuperAdmin) && can(item.perm),
                    ).map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton asChild isActive={path === item.to}>
                          <Link to={item.to}>
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={ADVANCED_ITEMS.some((item) => path === item.to)}
                  tooltip="Advanced"
                  onClick={() =>
                    collapsed
                      ? navigate({ to: "/admin/settings/system-health" })
                      : setAdvancedOpen((v) => !v)
                  }
                >
                  <Wrench />
                  <span>Advanced</span>
                  {!collapsed &&
                    (advancedOpen ? (
                      <ChevronDown className="ml-auto h-4 w-4" />
                    ) : (
                      <ChevronRight className="ml-auto h-4 w-4" />
                    ))}
                </SidebarMenuButton>
                {!collapsed && advancedOpen && (
                  <SidebarMenuSub>
                    {ADVANCED_ITEMS.filter((item) => can(item.perm)).map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton asChild isActive={path === item.to}>
                          <Link to={item.to}>
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

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

function SimpleItem({
  to,
  title,
  icon: Icon,
  active,
}: {
  to:
    | "/admin/dashboard"
    | "/admin/tools"
    | "/admin/customers"
    | "/admin/orders"
    | "/admin/transactions"
    | "/admin/settings/custom-payments";
  title: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link to={to}>
          <Icon />
          <span>{title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
