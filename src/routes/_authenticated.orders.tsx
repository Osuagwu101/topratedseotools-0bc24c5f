/**
 * My subscriptions — user-side view of every tool_orders row.
 *
 * When redirected back from Paystack with `?reference=…`, we call
 * `verifyPaystackPayment` so approved status shows immediately (the webhook
 * is the authoritative path but may be delayed).
 *
 * For approved subscriptions we also show the stored login credentials
 * (email / password / URL) plus expiry warnings — 7 days for 90/365-day
 * plans, and the 2-day grace-period notice for monthly plans past day 28.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useRouter, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  AlertTriangle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Rocket,
  Zap,
  Users,
  Lock,
  Repeat,
  ShieldOff,
  Hourglass,
} from "lucide-react";
import { z } from "zod";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { getTool, type Tool } from "@/lib/tools-data";
import {
  listMyOrders,
  cancelMyOrder,
  getMyAccess,
  listToolSettings,
  type ToolOrder,
  type ToolOrderStatus,
  type ToolSetting,
} from "@/lib/access.functions";
import { launchTool } from "@/lib/tool-launcher";
import { verifyPaystackPayment, disableOrderRenewal } from "@/lib/paystack.functions";
import { getPublicSiteSettings } from "@/lib/site-settings.functions";

const ordersQuery = queryOptions({
  queryKey: ["my-orders"],
  queryFn: () => listMyOrders(),
});
const accessQuery = queryOptions({
  queryKey: ["my-access"],
  queryFn: () => getMyAccess(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const siteQuery = queryOptions({
  queryKey: ["public-site-settings"],
  queryFn: () => getPublicSiteSettings(),
});

const searchSchema = z
  .object({
    reference: z.string().optional(),
    trxref: z.string().optional(),
    verify: z.string().optional(),
  })
  .partial();

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My subscriptions — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (raw) => searchSchema.parse(raw),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(ordersQuery),
      context.queryClient.ensureQueryData(accessQuery),
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(siteQuery),
    ]),
  component: MyOrdersPage,
});

const STATUS: Record<
  ToolOrderStatus,
  { label: string; cls: string; icon: typeof Clock }
> = {
  pending: { label: "Awaiting payment", cls: "bg-warning/15 text-warning", icon: Clock },
  approved: { label: "Active", cls: "bg-success/15 text-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive", icon: XCircle },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground", icon: PauseCircle },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground", icon: PauseCircle },
};

function MyOrdersPage() {
  const search = useSearch({ from: Route.id });
  const router = useRouter();
  const { data: ordersData } = useSuspenseQuery(ordersQuery);
  const { data: accessData } = useSuspenseQuery(accessQuery);
  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const { data: siteData } = useSuspenseQuery(siteQuery);
  const cancel = useServerFn(cancelMyOrder);
  const verify = useServerFn(verifyPaystackPayment);
  const disableRenewal = useServerFn(disableOrderRenewal);
  const [verifying, setVerifying] = useState(false);

  // If we came back from Paystack with a reference, verify once.
  useEffect(() => {
    const ref = search.reference ?? search.trxref;
    if (!ref || verifying) return;
    setVerifying(true);
    verify({ data: { reference: ref } })
      .then(() => {
        toast.success("Payment confirmed — your subscription is active.");
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Verification failed"),
      )
      .finally(() => {
        router.navigate({ to: "/orders", search: {}, replace: true });
        router.invalidate();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.reference, search.trxref]);

  async function onCancel(id: string) {
    try {
      await cancel({ data: { id } });
      toast.success("Order cancelled");
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  async function onDisableRenewal(o: ToolOrder) {
    if (!confirm(
      "Disable auto-renewal? Your access stays active until the current period ends, but no further payments will be taken.",
    )) return;
    try {
      await disableRenewal({ data: { order_id: o.id } });
      toast.success("Auto-renewal disabled. Access stays active until the period ends.");
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disable renewal");
    }
  }

  const now = Date.now();
  const accessBySlug = useMemo(() => {
    const map = new Map<string, (typeof accessData.access)[number]>();
    for (const a of accessData.access) map.set(a.tool_slug, a);
    return map;
  }, [accessData.access]);

  const settingBySlug = useMemo(() => {
    const map = new Map<string, ToolSetting>();
    for (const s of settingsData.settings) map.set(s.tool_slug, s);
    return map;
  }, [settingsData.settings]);


  const orders = ordersData.orders.map((o) => {
    const s: ToolOrderStatus =
      o.status === "approved" && o.expires_at && new Date(o.expires_at).getTime() < now
        ? "expired"
        : o.status;
    return { ...o, effectiveStatus: s };
  });

  return (
    <SiteLayout>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My subscriptions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every tool you've subscribed to. Active plans show your login details.
            </p>
          </div>
          <Link
            to="/tools"
            className="inline-flex items-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            Browse tools
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed p-12 text-center">
            <p className="text-sm text-muted-foreground">
              You don't have any subscriptions yet.
            </p>
            <Link
              to="/tools"
              className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
            >
              Explore the tool catalog →
            </Link>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {orders.map((o) => {
              const tool = getTool(o.tool_slug);
              const meta = STATUS[o.effectiveStatus];
              const Icon = meta.icon;
              const access =
                o.effectiveStatus === "approved" ? accessBySlug.get(o.tool_slug) : null;
              return (
                <li
                  key={o.id}
                  className="rounded-2xl border bg-card p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-4">
                    {tool ? (
                      <ToolBrandMark tool={tool} size="sm" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{tool?.name ?? o.tool_slug}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}
                        >
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {o.access_type ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {o.access_type === "private" ? (
                              <><Lock className="h-3 w-3" /> Private</>
                            ) : (
                              <><Users className="h-3 w-3" /> Shared</>
                            )}
                          </span>
                        ) : null}
                        {o.billing_period ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide capitalize">
                            {o.billing_period}
                          </span>
                        ) : null}
                        <span>
                          {o.price_amount !== null
                            ? `${o.currency}${o.price_amount.toLocaleString()}`
                            : "Custom pricing"}
                        </span>
                        <span>· Ordered {new Date(o.created_at).toLocaleDateString()}</span>
                        {o.paid_at && (
                          <span>· Paid {new Date(o.paid_at).toLocaleDateString()}</span>
                        )}
                        {o.next_payment_at && o.renewal_status === "enabled" && (
                          <span>· Next payment {new Date(o.next_payment_at).toLocaleDateString()}</span>
                        )}
                        {o.expires_at && (
                          <span>· Access ends {new Date(o.expires_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      <div className="mt-1"><SubStatusBadge order={o} /></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {o.effectiveStatus === "pending" && (
                        <>
                          {tool && (
                            <Link
                              to="/order/$slug" search={{}}
                              params={{ slug: tool.slug }}
                              className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
                            >
                              Complete payment
                            </Link>
                          )}
                          <button
                            onClick={() => onCancel(o.id)}
                            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {o.effectiveStatus === "approved" &&
                        o.renewal_status === "enabled" &&
                        !!o.paystack_subscription_code && (
                          <button
                            onClick={() => onDisableRenewal(o)}
                            className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            <ShieldOff className="h-3 w-3" /> Disable renewal
                          </button>
                        )}
                      {o.effectiveStatus === "approved" &&
                        (o.payment_type === "one_time" ||
                          o.renewal_status === "not_applicable") &&
                        tool && (
                          <Link
                            to="/order/$slug" search={{}}
                            params={{ slug: tool.slug }}
                            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            Renew access
                          </Link>
                        )}
                      {(o.effectiveStatus === "rejected" ||
                        o.effectiveStatus === "cancelled" ||
                        o.effectiveStatus === "expired") &&
                        tool && (
                          <Link
                            to="/order/$slug" search={{}}
                            params={{ slug: tool.slug }}
                            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            Renew
                          </Link>
                        )}
                    </div>
                  </div>

                  {o.effectiveStatus === "expired" && (
                    <div className="mt-3 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                      No active subscription for this tool. Renew to restore access.
                    </div>
                  )}

                  {o.effectiveStatus === "approved" &&
                    o.access_type === "private" &&
                    o.fulfilment_status === "pending" && (
                      <PrivatePendingBanner
                        order={o}
                        toolName={tool?.name ?? o.tool_slug}
                        whatsapp={siteData.adminWhatsappNumber}
                      />
                    )}

                  {access && tool && (
                    <CredentialCard
                      access={access}
                      tool={tool}
                      setting={settingBySlug.get(o.tool_slug)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SiteLayout>
  );
}

function SubStatusBadge({ order }: { order: ToolOrder }) {
  const items: { label: string; cls: string; Icon: typeof Repeat }[] = [];
  const isOneTime =
    order.payment_type === "one_time" || order.renewal_status === "not_applicable";
  if (order.status === "approved") {
    if (isOneTime) {
      items.push({ label: "One-time purchase", cls: "bg-muted text-muted-foreground", Icon: ShieldOff });
    } else {
      if (order.subscription_status === "past_due") {
        items.push({ label: "Past due", cls: "bg-warning/15 text-warning-foreground", Icon: AlertTriangle });
      }
      if (order.renewal_status === "enabled" && order.paystack_subscription_code) {
        items.push({ label: "Auto-renews", cls: "bg-primary/10 text-primary", Icon: Repeat });
      } else if (
        order.renewal_status === "disabled" ||
        order.renewal_status === "disable_pending" ||
        order.subscription_status === "non_renewing"
      ) {
        items.push({ label: "Renewal off", cls: "bg-muted text-muted-foreground", Icon: ShieldOff });
      }
    }
  }
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span
          key={i.label}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${i.cls}`}
        >
          <i.Icon className="h-3 w-3" /> {i.label}
        </span>
      ))}
    </div>
  );
}


function PrivatePendingBanner({
  order,
  toolName,
  whatsapp,
}: {
  order: ToolOrder;
  toolName: string;
  whatsapp: string | null;
}) {
  const periodLabel = (order.billing_period ?? "").toString().toUpperCase() || "—";
  const message =
    `Hello Admin, I have successfully paid for a Private Access subscription and would like my order to be fulfilled.\n\n` +
    `Order Reference: ${order.paystack_reference ?? order.id}\n` +
    `Tool: ${toolName}\n` +
    `Access Type: Private Access\n` +
    `Billing Period: ${periodLabel}\n` +
    `Amount Paid: ₦${(order.price_amount ?? 0).toLocaleString()}\n` +
    `Payment Status: Successful\n` +
    `Fulfilment Status: Pending\n\n` +
    `Please help me activate my Private Access order.`;
  const waUrl = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
    : null;
  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
      <div className="flex items-start gap-2">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <div className="font-medium">Payment successful. Your Private Access order is pending fulfilment.</div>
          <div className="mt-1 text-muted-foreground">
            An admin will assign your dedicated account. If it isn't ready within 6 hours,
            it will be auto-activated and your subscription period will start counting from that moment.
          </div>
          {order.fulfilment_deadline_at && (
            <div className="mt-1 text-muted-foreground">
              Auto-fulfilment by {new Date(order.fulfilment_deadline_at).toLocaleString()}.
            </div>
          )}
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground hover:opacity-90"
            >
              Contact Admin to Fulfil Order
            </a>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground italic">
              Admin WhatsApp number not configured yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CredentialCard({
  access,
  tool,
  setting,
}: {
  access: {
    tool_slug: string;
    expires_at: string | null;
    paid_at: string | null;
    duration_days: number | null;
    grace_days: number;
    warning_days: number;
    credentials: {
      email: string | null;
      password: string | null;
      login_url: string | null;
      login_notes: string | null;
    } | null;
  };
  tool: Tool;
  setting: ToolSetting | undefined;
}) {
  const [reveal, setReveal] = useState(false);
  const creds = access.credentials;
  const oneClick = !!setting?.one_click_auth_enabled;
  const showManual = setting?.display_manual_credentials ?? true;

  const banner = useMemo(() => {
    if (!access.expires_at) return null;
    const now = Date.now();
    const expiresAt = new Date(access.expires_at).getTime();
    const daysLeft = Math.ceil((expiresAt - now) / 86400_000);
    if (access.warning_days > 0 && daysLeft <= access.warning_days) {
      return {
        tone: "warning",
        text: `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — renew to avoid interruption.`,
      };
    }
    if (access.grace_days > 0 && access.paid_at && access.duration_days) {
      const billingEnd =
        new Date(access.paid_at).getTime() + access.duration_days * 86400_000;
      if (now >= billingEnd) {
        const graceLeft = Math.max(0, Math.ceil((expiresAt - now) / 86400_000));
        return {
          tone: "warning",
          text: `Grace period active — access ends in ${graceLeft} day${graceLeft === 1 ? "" : "s"}. Renew now to stay active.`,
        };
      }
    }
    return null;
  }, [access]);

  // One-Click Login mode → replace credentials with a "Launch Tool" button.
  if (oneClick) {
    return (
      <div className="mt-4 rounded-xl border bg-background/60 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          One-Click Login
        </div>
        {banner && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{banner.text}</span>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Click below to open the official {tool.name} login page. Sign in with
          your own {tool.name} account — your subscription here keeps your
          access active.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => launchTool(tool, setting)}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow hover:opacity-90"
          >
            <Rocket className="h-3.5 w-3.5" /> Launch {tool.name}
          </button>
        </div>
      </div>
    );
  }

  // Manual credentials mode — hide entirely if the admin turned it off.
  if (!showManual) {
    return (
      <div className="mt-4 rounded-xl border bg-background/60 p-4 text-xs text-muted-foreground">
        Your access is active. Contact support for login assistance.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border bg-background/60 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <KeyRound className="h-3.5 w-3.5" />
        Login details
      </div>

      {banner && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{banner.text}</span>
        </div>
      )}


      {!creds || (!creds.email && !creds.password && !creds.login_url) ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Your access is active. Login details will appear here as soon as the admin adds them.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {creds.login_url && (
            <a
              href={creds.login_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 font-medium hover:bg-muted sm:col-span-2"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open login page
            </a>
          )}
          {creds.email && (
            <CredField label="Email" value={creds.email} />
          )}
          {creds.password && (
            <CredField
              label="Password"
              value={creds.password}
              masked={!reveal}
              onToggle={() => setReveal((r) => !r)}
            />
          )}
          {creds.login_notes && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground sm:col-span-2">
              <span className="font-medium text-foreground">Notes: </span>
              {creds.login_notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CredField({
  label,
  value,
  masked,
  onToggle,
}: {
  label: string;
  value: string;
  masked?: boolean;
  onToggle?: () => void;
}) {
  const shown = masked ? "•".repeat(Math.min(value.length, 12)) : value;
  return (
    <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="ml-1 flex-1 truncate font-mono">{shown}</span>
      {onToggle && (
        <button
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label={masked ? "Reveal" : "Hide"}
        >
          {masked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success(`${label} copied`);
        }}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
