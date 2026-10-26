-- Synthetic, disposable Phase 3 database tests. No customer data or credentials.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
\ir ../supabase/migrations/20261026080000_phrasly_aws_oneclick_phase3.sql
\ir ../supabase/migrations/20261026080100_phrasly_aws_oneclick_allocator.sql
\ir ../supabase/migrations/20261026080200_phrasly_aws_tool_config.sql
-- Migrations must safely reapply.
\ir ../supabase/migrations/20261026080000_phrasly_aws_oneclick_phase3.sql
\ir ../supabase/migrations/20261026080100_phrasly_aws_oneclick_allocator.sql
\ir ../supabase/migrations/20261026080200_phrasly_aws_tool_config.sql
DO $$
BEGIN
 IF has_table_privilege('anon','public.phrasly_oneclick_accounts','SELECT')
 OR has_table_privilege('authenticated','public.phrasly_oneclick_accounts','SELECT')
 OR has_function_privilege('authenticated','public.phrasly_oneclick_count_attempt(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'RLS/grants exposure'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO public.phrasly_oneclick_accounts(id,label,target_url,encrypted_cookies,capacity,enabled,created_at)
 VALUES('10000000-0000-4000-8000-000000000001','Fixture account 1','https://phrasly.ai','synthetic-fixture-not-a-cookie',1,true,'2026-10-01'),
       ('10000000-0000-4000-8000-000000000002','Fixture account 2','https://phrasly.ai','synthetic-fixture-not-a-cookie',1,true,'2026-10-02');
INSERT INTO public.phrasly_oneclick_feature_grants(user_id,feature_key,daily_limit,enabled)
VALUES('00000000-0000-4000-8000-000000000001','humanizer',2,true);
DO $$
DECLARE a uuid;b uuid;c uuid; x record;y record;z record;
BEGIN
 a := public.phrasly_oneclick_assign_account('00000000-0000-4000-8000-000000000001');
 b := public.phrasly_oneclick_assign_account('00000000-0000-4000-8000-000000000001');
 c := public.phrasly_oneclick_assign_account('00000000-0000-4000-8000-000000000002');
 IF a != '10000000-0000-4000-8000-000000000001'::uuid OR a != b OR
 c != '10000000-0000-4000-8000-000000000002'::uuid THEN RAISE EXCEPTION 'allocator parity failed'; END IF;
 SELECT * INTO x FROM public.phrasly_oneclick_count_attempt('00000000-0000-4000-8000-000000000001','humanizer');
 SELECT * INTO y FROM public.phrasly_oneclick_count_attempt('00000000-0000-4000-8000-000000000001','humanizer');
 SELECT * INTO z FROM public.phrasly_oneclick_count_attempt('00000000-0000-4000-8000-000000000001','humanizer');
 IF x.allowed IS DISTINCT FROM true OR x.used!=1 OR y.allowed IS DISTINCT FROM true OR y.used!=2 OR
 z.allowed IS DISTINCT FROM false OR z.used!=2 OR z.daily_limit!=2
 THEN RAISE EXCEPTION 'usage counting parity failed'; END IF;
END $$;
SELECT 'PHRASLY_PHASE3_DB_TEST_PASS' AS result;
