/**
 * Admin permissions — client-safe constants shared by the sidebar and the
 * server-side resolver. No DB access here; the SQL function
 * `public.admin_effective_permission` mirrors this truth table.
 */

export type RoleKey = "operations" | "finance" | "support" | "content" | "marketing";

export const ROLE_KEYS: RoleKey[] = ["operations", "finance", "support", "content", "marketing"];

export const ALL_PERMISSIONS = [
  "customers.view",
  "customers.edit",
  "orders.manage",
  "payments.manage",
  "refunds.process",
  "subscriptions.manage",
  "credentials.view",
  "credentials.edit",
  "tools.manage",
  "content.manage",
  "promotions.manage",
  "support.manage",
  "emails.manage",
  "marketing.manage",
  "api_keys.manage",
  "staff.manage",
  "audit.view",
  "system_health.access",
  "backups.access",
  "emergency.use",
  "migration.access",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_GROUPS: Array<{
  key: string;
  label: string;
  sensitive?: boolean;
  items: Array<{ id: Permission; label: string }>;
}> = [
  {
    key: "customers",
    label: "Customers & orders",
    items: [
      { id: "customers.view", label: "View customers" },
      { id: "customers.edit", label: "Edit customers" },
      { id: "orders.manage", label: "Manage orders" },
      { id: "subscriptions.manage", label: "Manage subscriptions" },
    ],
  },
  {
    key: "payments",
    label: "Payments & refunds",
    sensitive: true,
    items: [
      { id: "payments.manage", label: "Manage payments" },
      { id: "refunds.process", label: "Process refunds" },
    ],
  },
  {
    key: "credentials",
    label: "Tools & credentials",
    sensitive: true,
    items: [
      { id: "credentials.view", label: "View credentials" },
      { id: "credentials.edit", label: "Edit credentials" },
      { id: "tools.manage", label: "Manage tools" },
    ],
  },
  {
    key: "content",
    label: "Content, marketing & support",
    items: [
      { id: "content.manage", label: "Manage content" },
      { id: "promotions.manage", label: "Manage promotions" },
      { id: "support.manage", label: "Manage support tickets" },
      { id: "emails.manage", label: "Manage emails" },
      { id: "marketing.manage", label: "Manage marketing" },
    ],
  },
  {
    key: "system",
    label: "System (critical)",
    sensitive: true,
    items: [
      { id: "api_keys.manage", label: "Manage API keys" },
      { id: "staff.manage", label: "Manage staff" },
      { id: "audit.view", label: "View admin activity" },
      { id: "system_health.access", label: "Access system health" },
      { id: "backups.access", label: "Access backups" },
      { id: "emergency.use", label: "Use emergency controls" },
      { id: "migration.access", label: "Access migration settings" },
    ],
  },
];

export const ROLE_DEFAULTS: Record<RoleKey, Permission[]> = {
  operations: [
    "customers.view",
    "customers.edit",
    "orders.manage",
    "subscriptions.manage",
    "credentials.view",
  ],
  finance: [
    "customers.view",
    "orders.manage",
    "payments.manage",
    "refunds.process",
    "subscriptions.manage",
  ],
  support: ["customers.view", "support.manage", "orders.manage"],
  content: ["content.manage", "promotions.manage"],
  marketing: ["marketing.manage", "emails.manage", "promotions.manage"],
};

export const ROLE_LABEL: Record<RoleKey, string> = {
  operations: "Operations Admin",
  finance: "Finance Admin",
  support: "Support Admin",
  content: "Content Manager",
  marketing: "Marketing Manager",
};

/**
 * Pure resolver — mirrors public.admin_effective_permission. Used only for
 * sidebar filtering. Server enforcement uses the SQL function.
 */
export function resolveEffectivePermissions(input: {
  isActiveAdmin: boolean;
  isSuperAdmin: boolean;
  roleKey: RoleKey | null;
  overrides: Record<string, boolean>;
}): Permission[] {
  if (!input.isActiveAdmin) return [];
  if (input.isSuperAdmin) return [...ALL_PERMISSIONS];
  const defaults: Permission[] = input.roleKey ? ROLE_DEFAULTS[input.roleKey] ?? [] : [];
  const set = new Set<Permission>(defaults);
  for (const perm of ALL_PERMISSIONS) {
    if (Object.prototype.hasOwnProperty.call(input.overrides, perm)) {
      if (input.overrides[perm]) set.add(perm);
      else set.delete(perm);
    }
  }
  return Array.from(set);
}

export function hasPermission(list: readonly string[], perm: Permission): boolean {
  return list.includes(perm);
}
