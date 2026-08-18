-- The final SneakWrite One-Click flow verifies the admin-managed account
-- credentials directly with SneakWrite and no longer uses cross-app tickets.
drop table if exists public.direct_sso_tickets;
