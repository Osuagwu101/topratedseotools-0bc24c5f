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
  Palette,
  LogOut,
  ChevronDown,
  ChevronRight,
  Search,
  ShieldCheck,
  Cog,
  UserCog,
  Star,
  Megaphone,
} from "lucide-react";
import { getAdminContext } from "@/lib/admin-management.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SiteLayout } from "@/components/site/SiteLayout";
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
  
  { title: "Appearance", to: "/admin/appearance", icon: Palette },
  { title: "Email", to: "/admin/settings/email", icon: Cog },
  { title: "Settings", to: "/admin/appearance", icon: Cog },
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

type ReviewsSearch = { status: string; min_rating?: number };
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
    <SiteLayout>
      <SidebarProvider defaultOpen>
        <div className="flex w-full min-h-[calc(100vh-4rem)]">
          <AdminSidebar />
          <div className="flex-1 min-w-0">
            <div className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
              <SidebarTrigger />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Admin
              </span>
            </div>
            <div className="min-h-full">{children}</div>
          </div>
        </div>
      </SidebarProvider>
    </SiteLayout>
  );
}

function AdminSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
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
  const [q, setQ] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => {
    getAdminContext()
      .then((c) => setIsSuperAdmin(!!c.isSuperAdmin))
      .catch(() => setIsSuperAdmin(false));
  }, []);

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




              {NAV.filter((n) => n.title !== "Dashboard").map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item)}
                    tooltip={item.title}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

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
