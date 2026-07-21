# Phase 1 — Admin Control Foundation

Scope: only Phase 1. Phases 2–8 get menu placeholders under Settings. No customer/tool/payment/blog/email/marketing changes beyond adding an invitation + audit surface.

## 1. Settings menu (single sidebar reorg)

Edit `src/components/admin/AdminShell.tsx`. Add one new collapsible **Settings** group. Existing top-level items (Dashboard, Tools, Customers, Orders, Transactions, Blog, Integrations, Reviews) stay put. **Access Health** and **Awaiting Assignment** move INTO Settings (their existing routes stay; only the sidebar entry moves) so each feature has one canonical menu location.

Settings children, exact order:

Normal Settings
1. Settings Overview → `/admin/settings` (live)
2. General Website Settings → `/admin/settings/general` (Phase 2)
3. Website Content → `/admin/settings/content` (Phase 2)
4. Tools & Products → `/admin/settings/tools-products` (Phase 2)
5. Credentials & Capacity → `/admin/settings/credentials` (Phase 3)
6. Access Health → `/admin/access-health` (existing)
7. Promotions & Rewards → `/admin/settings/promotions` (Phase 4)
8. Business Rules → `/admin/settings/business-rules` (Phase 4)
9. Support Tickets → `/admin/settings/support` (Phase 6)
10. Customer Communications → `/admin/settings/communications` (Phase 6)
11. Automations → `/admin/settings/automations` (Phase 7)
12. Admin Activity → `/admin/settings/activity` (live)

Divider `Critical Controls`, always bottom:

13. Payment Recovery → `/admin/settings/payment-recovery` (Phase 5)
14. API Keys & Providers → `/admin/settings/api-keys` (Phase 5)
15. Staff, Roles & Permissions → `/admin/settings/staff` (live, Super Admin only)
16. Security Centre → `/admin/settings/security` (Phase 7)
17. System Health & Repair → `/admin/settings/system-health` (Phase 7)
18. Backup & Recovery → `/admin/settings/backup` (Phase 7)
19. Emergency Controls → `/admin/settings/emergency` (Phase 7)
20. Migration & Launch → `/admin/settings/migration` (Phase 8)

Behavior: open-state stored in `localStorage['admin.settings.open']`; auto-opens when path starts with `/admin/settings` or `/admin/access-health`; active item highlighted via router pathname; hidden children when the current admin lacks the permission (server enforces separately). Works in the existing mobile sheet variant of the sidebar.

Phase 2–8 pages render a shared `PhasePlaceholder` component: phase chip, one-line description, no buttons, no fake stats.

## 2. Single source of truth for admin authority

Resolution order (both server and client use it):

1. Active admin? `admin_accounts` row exists AND `user_roles` row with `role='admin' AND is_active=true`. Fails ⇒ zero authority.
2. Super Admin? `user_roles.is_super_admin=true`. Supers implicitly hold every permission; role/overrides are not consulted.
3. Role defaults from `admin_accounts.role_key` (`operations|finance|support|content|marketing`) mapped to a hard-coded permission set.
4. Individual overrides from `admin_permissions(user_id, permission, granted)`.

Implemented once in SQL as `public.admin_effective_permission(_uid uuid, _perm text) returns boolean` (SECURITY DEFINER, used by RLS) and mirrored in `src/lib/admin-permissions.ts` (pure constants — no DB access) for the sidebar. A test locks the two truth tables together.

## 3. Database (one migration)

- `admin_accounts.role_key text` nullable, CHECK in the five role keys.
- `admin_permissions(user_id uuid pk-part, permission text pk-part, granted boolean, updated_at, updated_by)`.
- `admin_activity_log(id, actor_user_id, actor_email, actor_role, action, area, target_type, target_id, success boolean, reason, reference, created_at)` — append-only.
- `admin_invitations(id, email citext, role_key, invited_by, auth_user_id, status check in ('pending','accepted','expired','revoked'), expires_at, accepted_at, created_at)` — no token column; Supabase Auth owns the token.
- `admin_effective_permission()` SQL fn encoding the 4-step precedence.
- Extend `protect_last_super_admin` to also block DELETE of the last active super-admin row.
- RLS + GRANTs:
  - `admin_permissions`: super-admin-only SELECT/mutate; `service_role` ALL.
  - `admin_invitations`: super-admin-only; `service_role` ALL.
  - `admin_activity_log`: SELECT policy = `is_super_admin(auth.uid()) OR admin_effective_permission(auth.uid(),'audit.view')`. **No INSERT/UPDATE/DELETE policies for authenticated** — writes go through `service_role` only. GRANT SELECT to authenticated; ALL to service_role.

Post-approval, `src/integrations/supabase/types.ts` is auto-regenerated; server fns and UI import from that file. Report lists it under files changed.

## 4. Server functions

`src/lib/admin-permissions.functions.ts`:
- `getMyAdminContext()` → `{isAdmin, isSuperAdmin, roleKey, permissions[], capabilities:{canEndSessions:boolean}}` via the SQL resolver.
- `listStaff()` (super) — admins with role, effective permissions, invitation status (reconciled inline), `auth.users.last_sign_in_at`, `must_change_password`.
- `createStaff({email, fullName, roleKey})` — SINGLE flow: `supabaseAdmin.auth.admin.inviteUserByEmail(email)` + upsert `admin_accounts` + `user_roles(role='admin',is_active=true)` + `admin_invitations(status='pending', auth_user_id=<returned>, expires_at=now()+72h)`. Idempotent on email — a pending row short-circuits without re-emailing. One email per invitation; no separate token, no second email.
- `resendInvitation({id})` — calls `inviteUserByEmail` again, updates the same row's `expires_at`.
- `revokeInvitation({id})` — status='revoked' + disables auth user if still unaccepted.
- `updateStaffRole`, `setStaffPermission`, `resetStaffToRoleDefaults`, `disableStaff`, `restoreStaff`, `requirePasswordReset` (existing `must_change_password` mechanism).
- `endStaffSessions({userId})` — feature-detect `supabaseAdmin.auth.admin.signOut` at module init; if unavailable, `capabilities.canEndSessions=false`, UI hides the control, staff row shows "Session control not supported".

Sensitive-action audit (Correction 4): for role change, permission change, disable admin, view credentials, edit credentials, end sessions, change payment settings, change API providers, use emergency controls — the audit row is written synchronously with `supabaseAdmin` in the SAME handler and its failure aborts the action with a user-facing "Action could not be recorded — no change was made". Non-sensitive activity may swallow logging errors.

`src/lib/admin-activity.functions.ts`:
- `listAdminActivity({filters, page})` — gated `is_super_admin OR audit.view`; RLS enforces the same rule as defense in depth.

`src/lib/admin-overview.functions.ts`:
- `getSettingsOverview()` returns `requiresAttention[]` computed from real sources only:
  - Pending Private fulfilment (`tool_orders`)
  - Awaiting assignment (existing `access-health`)
  - Failed emails (`email_messages`)
  - Expired invitations (`admin_invitations`)
  - Disabled admins (`user_roles.is_active=false`)
  Plus `quickActions[]` filtered by permissions, `recentActivity[]` (empty when the caller lacks audit view), `phaseProgress` (Phase 1 = Active until verification signs off; Phases 2–8 = Not Started).

## 5. Routes

Live: `admin.settings.tsx` (layout, `ssr:false`, `beforeLoad: requireAdmin`), `admin.settings.index.tsx`, `admin.settings.activity.tsx` (loader gates on audit permission), `admin.settings.staff.tsx` (loader gates on super).

Placeholders: the 15 Phase 2–8 route files, each rendering `<PhasePlaceholder phase={n} name="…" />`.

## 6. Staff, Roles & Permissions UI

Staff table with row actions: Edit, Disable/Restore, End sessions (hidden if unsupported), Require password reset, Resend/Revoke invitation. Displays: last sign-in, invitation status, password-reset-required. Active session count is NOT shown (Supabase does not expose it).

Add Admin dialog: name, email, role, permission preview, single "Send Invitation" button.

Permissions drawer: grouped checkboxes with warning banner on sensitive groups (Credentials, Payments, Refunds, API Keys, Staff, Backups, Emergency), Select All / Clear / Reset to Role Defaults / Save with diff-summary confirmation.

Server rules: last-super-admin protected against demote/disable/self-disable/delete; all sensitive changes gated by synchronous audit; unauthorized attempts write `success=false` rows.

## 7. Settings Overview UI

Four cards: Requires Attention (from real data — empty state when nothing), Quick Actions (permission-filtered), Recent Admin Activity (empty for admins without audit view), Phase Progress. No decorative counters.

## 8. Confirmations & unsaved-work primitives

New `src/components/admin/ConfirmDialog.tsx` used for every sensitive action (title, what/who, single-click guard, success only after server confirms). `useUnsavedChanges` hook via router `useBlocker` on staff/permission forms; form state preserved on validation errors.

## 9. Verification

Automated:
- `tsgo --noEmit`
- `bun test` including new files:
  - `tests/admin-permissions.test.ts` — resolver precedence (inactive < active < role defaults < overrides < super trumps all), last-super-admin guard, SQL↔TS mirror.
  - `tests/admin-activity.test.ts` — audit row shape; regex-assert `password|token|secret|api[_-]?key|authorization|cookie` never appears in serialized rows; sensitive-action synchronous-log-or-fail; 403 for non-viewer.
  - `tests/admin-invite.test.ts` — single email per new admin, idempotent repeat, resend updates same row.

Live walkthrough with the supplied super-admin account (Correction 10: credentials entered only in the browser login screen; never written to code/tests/migrations/logs/screenshots/env vars/report; the report ends by reminding the operator to rotate the password because it was shared for testing):

1. Login. 2. Settings expand/collapse/persist across refresh + navigation. 3. Item order correct; Critical Controls last. 4. Desktop + mobile widths. 5. Overview shows real data. 6. Create a **real test admin** at an inbox the operator controls (address supplied in the browser only, never persisted to code/report; account labeled "TEST — Phase 1 verification"). 7. Only one invitation email arrives. 8. Accept → set password → sign in → assigned role granted. 9. Permitted pages open; restricted URLs return server 403 when typed directly. 10. Role change takes effect immediately (existing session revalidated on next server call). 11. Permission change persists after refresh. 12. Disable ends access; restore returns approved access. 13. End sessions works OR is reported as unsupported. 14. Last-super-admin protection blocks self-disable/demote/delete. 15. Activity log records each step, no secrets present. 16. Regression sweep: customer signup/login, existing admin dashboards, tools/pricing/orders/reviews/marketing/email unaffected. 17. Cleanup: disable (do not delete) test admin, keep audit history.

## Out of scope

Any real Phase 2–8 functionality. Any change to customer routes, Paystack, blog, marketing, email templates beyond the invitation/audit surface above.

## Technical details

- `admin_effective_permission`: short-circuits — super → true; not-active-admin → false; else `COALESCE(override.granted, permission IN role_default_set)`. Role→default map generated from the shared constant list.
- Sensitive-action handler pattern: insert audit `success=null` row → perform action → update row `success=true` (or write `success=false, reason=…` and rethrow). Audit-insert failure short-circuits before the action runs.
- Invitation status reconciliation runs inline on `listStaff` reads (checks `auth.users.email_confirmed_at`) so no background worker is introduced in Phase 1.
- `endStaffSessions` capability: detected once at module init by `typeof supabaseAdmin.auth.admin.signOut === 'function'`; surfaced via `getMyAdminContext().capabilities.canEndSessions`.
- Sidebar filtering imports only `src/lib/admin-permissions.ts` (client-safe). Server enforcement uses the SQL resolver + `requireSupabaseAuth`.
- Hosting-independent: no Cloudflare/Vercel-specific APIs; all logic runs in TanStack server functions + Supabase (Postgres + Auth) — portable to any Node/Workers host.
