-- Consolidated schema for Top Rated SEO Tools
-- Generated from supabase/migrations (90 files, in chronological order).
-- Apply against a FRESH Supabase project: supabase db push, or paste into the SQL editor.


-- =============================================================
-- migration: 20260716210540_d051d050-f28b-4e0d-b665-185d7568b710.sql
-- =============================================================


-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  notification_email BOOLEAN NOT NULL DEFAULT true,
  notification_product BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- FAVORITES
CREATE TABLE public.user_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool_slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_favorites TO authenticated;
GRANT ALL ON public.user_favorites TO service_role;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own favs" ON public.user_favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RECENT TOOL USAGE
CREATE TABLE public.tool_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tool_usage (user_id, used_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_usage TO authenticated;
GRANT ALL ON public.tool_usage TO service_role;
ALTER TABLE public.tool_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own usage" ON public.tool_usage FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SUBSCRIPTIONS
CREATE TABLE public.user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'inactive',
  interval TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sub select" ON public.user_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own sub update" ON public.user_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- CONTACT MESSAGES (public insert, admin read later)
CREATE TABLE public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT ALL ON public.contact_messages TO service_role;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can send" ON public.contact_messages FOR INSERT TO anon, authenticated WITH CHECK (
  length(name) BETWEEN 1 AND 100 AND
  length(email) BETWEEN 3 AND 200 AND
  length(message) BETWEEN 1 AND 5000
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER subs_touch BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Auto-create profile + subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  INSERT INTO public.user_subscriptions (user_id) VALUES (NEW.id);
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================
-- migration: 20260716210547_2b654004-5fc9-4c00-91b6-b79fd9f7552d.sql
-- =============================================================


REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;


-- =============================================================
-- migration: 20260716212209_01122a59-c964-4d7c-8244-f10b2116448f.sql
-- =============================================================

-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own roles select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- has_role helper (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Site settings (singleton row)
CREATE TABLE public.site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  active_theme text NOT NULL DEFAULT 'theme-1' CHECK (active_theme IN ('theme-1', 'theme-2')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read site settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "admins can insert site settings" ON public.site_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update site settings" ON public.site_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER site_settings_touch
BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the single settings row
INSERT INTO public.site_settings (id, active_theme) VALUES (true, 'theme-1')
ON CONFLICT (id) DO NOTHING;


-- =============================================================
-- migration: 20260716212219_4868d837-0a88-4d38-8f89-35e1174e8741.sql
-- =============================================================

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;


-- =============================================================
-- migration: 20260716215303_040414d6-a96a-4cc9-8f59-ea18bff47e3e.sql
-- =============================================================


CREATE TABLE public.tool_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_slug text NOT NULL,
  label text,
  amount numeric(12,2),
  unit text,
  currency text NOT NULL DEFAULT '₦',
  contact_admin boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_pricing_tool_slug_idx ON public.tool_pricing(tool_slug);

GRANT SELECT ON public.tool_pricing TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tool_pricing TO authenticated;
GRANT ALL ON public.tool_pricing TO service_role;

ALTER TABLE public.tool_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read tool pricing" ON public.tool_pricing
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admins can insert tool pricing" ON public.tool_pricing
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins can update tool pricing" ON public.tool_pricing
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins can delete tool pricing" ON public.tool_pricing
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER tool_pricing_touch_updated_at
  BEFORE UPDATE ON public.tool_pricing
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed initial pricing
INSERT INTO public.tool_pricing (tool_slug, label, amount, unit, sort_order) VALUES
  ('stealthwriter', NULL, 17000, 'month', 0),
  ('chatgpt',       NULL,  8500, 'month', 0),
  ('capcut',        NULL,  5000, 'month', 0),
  ('canva-pro',     'Shared account',  3000, 'year', 0),
  ('canva-pro',     'Private account', 6500, 'year', 1),
  ('phrasly',       NULL,  8500, 'month', 0),
  ('quillbot',      NULL,  2500, 'month', 0),
  ('grammarly',     NULL,  2500, 'month', 0),
  ('semrush',       NULL,  3000, 'month', 0),
  ('turnitin',      NULL,  2300, 'check', 0);

-- Every other tool defaults to "Contact admin"
INSERT INTO public.tool_pricing (tool_slug, contact_admin)
SELECT slug, true FROM (VALUES
  ('ahrefs'),('midjourney'),('elevenlabs'),('originality-ai'),('gptzero'),
  ('deepl'),('notion-ai'),('gamma'),('suno'),('perplexity'),('prompt-lab')
) AS t(slug);


-- =============================================================
-- migration: 20260716221432_a9078648-e57a-460d-8bde-0963aa347d31.sql
-- =============================================================

-- 1. tool_access enum
DO $$ BEGIN
  CREATE TYPE public.tool_access_level AS ENUM ('public', 'logged_in', 'purchased');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.tool_order_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. tool_settings
CREATE TABLE IF NOT EXISTS public.tool_settings (
  tool_slug TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  access_level public.tool_access_level NOT NULL DEFAULT 'purchased',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tool_settings TO anon, authenticated;
GRANT ALL ON public.tool_settings TO service_role;
ALTER TABLE public.tool_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_settings readable by all" ON public.tool_settings;
CREATE POLICY "tool_settings readable by all" ON public.tool_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "tool_settings admin write" ON public.tool_settings;
CREATE POLICY "tool_settings admin write" ON public.tool_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tool_settings_updated
  BEFORE UPDATE ON public.tool_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. tool_orders
CREATE TABLE IF NOT EXISTS public.tool_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug TEXT NOT NULL,
  pricing_option_id UUID REFERENCES public.tool_pricing(id) ON DELETE SET NULL,
  price_amount NUMERIC(12,2),
  price_label TEXT,
  currency TEXT NOT NULL DEFAULT '₦',
  status public.tool_order_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  admin_notes TEXT,
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_orders_user ON public.tool_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_orders_active ON public.tool_orders(user_id, tool_slug, status);

GRANT SELECT, INSERT, UPDATE ON public.tool_orders TO authenticated;
GRANT ALL ON public.tool_orders TO service_role;
ALTER TABLE public.tool_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders owner select" ON public.tool_orders;
CREATE POLICY "orders owner select" ON public.tool_orders FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "orders owner insert" ON public.tool_orders;
CREATE POLICY "orders owner insert" ON public.tool_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders owner cancel" ON public.tool_orders;
CREATE POLICY "orders owner cancel" ON public.tool_orders FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending','cancelled'));
DROP POLICY IF EXISTS "orders admin write" ON public.tool_orders;
CREATE POLICY "orders admin write" ON public.tool_orders FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tool_orders_updated
  BEFORE UPDATE ON public.tool_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. Helper: does current user have active access to a tool?
CREATE OR REPLACE FUNCTION public.user_has_tool_access(_user_id UUID, _slug TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tool_orders
    WHERE user_id = _user_id
      AND tool_slug = _slug
      AND status = 'approved'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;


-- =============================================================
-- migration: 20260716221442_b0a9b1b1-6ef2-4413-a996-0af170b6fe4f.sql
-- =============================================================

REVOKE ALL ON FUNCTION public.user_has_tool_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tool_access(UUID, TEXT) TO service_role;


-- =============================================================
-- migration: 20260716224500_5c8f166e-1479-4c73-a928-e8d2b3790754.sql
-- =============================================================


ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_days integer NOT NULL DEFAULT 0;

UPDATE public.tool_pricing SET
  duration_days = COALESCE(duration_days, CASE
    WHEN unit ILIKE '%year%' OR unit ILIKE '%annual%' THEN 365
    WHEN unit ILIKE '%3 month%' OR unit ILIKE '%quarter%' THEN 90
    WHEN unit ILIKE '%month%' THEN 28
    WHEN unit ILIKE '%week%' THEN 7
    ELSE 28 END),
  grace_days = CASE
    WHEN unit ILIKE '%month%' AND unit NOT ILIKE '%3 month%' THEN 2
    ELSE 0 END,
  warning_days = CASE
    WHEN unit ILIKE '%year%' OR unit ILIKE '%annual%' OR unit ILIKE '%3 month%' OR unit ILIKE '%quarter%' THEN 7
    WHEN unit ILIKE '%month%' THEN 2
    ELSE 0 END
WHERE contact_admin = false;

ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS login_email text,
  ADD COLUMN IF NOT EXISTS login_password text,
  ADD COLUMN IF NOT EXISTS login_url text,
  ADD COLUMN IF NOT EXISTS login_notes text;

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS paystack_reference text UNIQUE,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_days integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS tool_orders_paystack_ref_idx ON public.tool_orders(paystack_reference);


-- =============================================================
-- migration: 20260716224741_0a5739aa-818a-494b-8ff3-de70f5ba9373.sql
-- =============================================================


CREATE TABLE IF NOT EXISTS public.tool_credentials (
  tool_slug text PRIMARY KEY,
  login_email text,
  login_password text,
  login_url text,
  login_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_credentials TO authenticated;
GRANT ALL ON public.tool_credentials TO service_role;

ALTER TABLE public.tool_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_credentials admins full access" ON public.tool_credentials;
CREATE POLICY "tool_credentials admins full access"
  ON public.tool_credentials FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Backfill from any values that may have been stored on tool_settings
INSERT INTO public.tool_credentials (tool_slug, login_email, login_password, login_url, login_notes)
SELECT tool_slug, login_email, login_password, login_url, login_notes
FROM public.tool_settings
WHERE login_email IS NOT NULL OR login_password IS NOT NULL OR login_url IS NOT NULL OR login_notes IS NOT NULL
ON CONFLICT (tool_slug) DO NOTHING;

ALTER TABLE public.tool_settings
  DROP COLUMN IF EXISTS login_email,
  DROP COLUMN IF EXISTS login_password,
  DROP COLUMN IF EXISTS login_url,
  DROP COLUMN IF EXISTS login_notes;

CREATE TRIGGER tool_credentials_touch BEFORE UPDATE ON public.tool_credentials
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- =============================================================
-- migration: 20260717053612_834e97bd-b332-487e-a5f1-f7377fef018a.sql
-- =============================================================


-- Remove client-side ability to self-grant subscription plan/status
DROP POLICY IF EXISTS "own sub update" ON public.user_subscriptions;

-- Admins can view/manage subscriptions (via service role/admin server fns)
CREATE POLICY "admins manage subscriptions" ON public.user_subscriptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can read contact form submissions
CREATE POLICY "admins read contact messages" ON public.contact_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Explicit admin-only management of user_roles
CREATE POLICY "admins manage user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- =============================================================
-- migration: 20260717170912_fd9f596f-5e2b-43ec-a383-84968c8b47ec.sql
-- =============================================================

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;


-- =============================================================
-- migration: 20260717171643_56036561-d70e-4889-8275-9fd17197e720.sql
-- =============================================================

GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


-- =============================================================
-- migration: 20260717171715_e03b6644-14b1-4043-bd7c-ef287cf83f6c.sql
-- =============================================================

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;


-- =============================================================
-- migration: 20260717182622_b4fdcd0c-f17f-4489-84a5-8186f74e8243.sql
-- =============================================================


-- CATEGORIES
CREATE TABLE public.blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_categories TO anon, authenticated;
GRANT ALL ON public.blog_categories TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.blog_categories TO authenticated;
ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories are viewable by everyone" ON public.blog_categories FOR SELECT USING (true);
CREATE POLICY "Admins manage categories" ON public.blog_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_blog_categories_updated BEFORE UPDATE ON public.blog_categories FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- TAGS
CREATE TABLE public.blog_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_tags TO anon, authenticated;
GRANT ALL ON public.blog_tags TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.blog_tags TO authenticated;
ALTER TABLE public.blog_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tags are viewable by everyone" ON public.blog_tags FOR SELECT USING (true);
CREATE POLICY "Admins manage tags" ON public.blog_tags FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_blog_tags_updated BEFORE UPDATE ON public.blog_tags FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- POSTS
CREATE TYPE public.blog_post_status AS ENUM ('draft','scheduled','published','archived');

CREATE TABLE public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  featured_image TEXT,
  category_id UUID REFERENCES public.blog_categories(id) ON DELETE SET NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.blog_post_status NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  reading_time_minutes INT NOT NULL DEFAULT 1,
  view_count INT NOT NULL DEFAULT 0,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_posts_status_pub_idx ON public.blog_posts(status, published_at DESC);
CREATE INDEX blog_posts_category_idx ON public.blog_posts(category_id);
CREATE INDEX blog_posts_author_idx ON public.blog_posts(author_id);

GRANT SELECT ON public.blog_posts TO anon, authenticated;
GRANT ALL ON public.blog_posts TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.blog_posts TO authenticated;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Published posts are public" ON public.blog_posts FOR SELECT USING (status = 'published' AND (published_at IS NULL OR published_at <= now()));
CREATE POLICY "Admins read all posts" ON public.blog_posts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage posts" ON public.blog_posts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_blog_posts_updated BEFORE UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- POST <-> TAG JOIN
CREATE TABLE public.blog_post_tags (
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
GRANT SELECT ON public.blog_post_tags TO anon, authenticated;
GRANT ALL ON public.blog_post_tags TO service_role;
GRANT INSERT, DELETE ON public.blog_post_tags TO authenticated;
ALTER TABLE public.blog_post_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Post-tag joins are readable" ON public.blog_post_tags FOR SELECT USING (true);
CREATE POLICY "Admins manage post-tags" ON public.blog_post_tags FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- REVISIONS
CREATE TABLE public.blog_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  excerpt TEXT,
  content TEXT NOT NULL,
  featured_image TEXT,
  edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_revisions_post_idx ON public.blog_revisions(post_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.blog_revisions TO authenticated;
GRANT ALL ON public.blog_revisions TO service_role;
ALTER TABLE public.blog_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage revisions" ON public.blog_revisions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- COMMENTS
CREATE TABLE public.blog_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_comments_post_idx ON public.blog_comments(post_id, created_at DESC);
GRANT SELECT, INSERT ON public.blog_comments TO anon, authenticated;
GRANT UPDATE, DELETE ON public.blog_comments TO authenticated;
GRANT ALL ON public.blog_comments TO service_role;
ALTER TABLE public.blog_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved comments are public" ON public.blog_comments FOR SELECT USING (status = 'approved');
CREATE POLICY "Admins read all comments" ON public.blog_comments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can submit comment" ON public.blog_comments FOR INSERT WITH CHECK (status = 'pending');
CREATE POLICY "Admins moderate comments" ON public.blog_comments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete comments" ON public.blog_comments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_blog_comments_updated BEFORE UPDATE ON public.blog_comments FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- BLOG SETTINGS (singleton)
CREATE TABLE public.blog_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comments_enabled BOOLEAN NOT NULL DEFAULT true,
  hero_title TEXT NOT NULL DEFAULT 'Insights & Guides',
  hero_subtitle TEXT NOT NULL DEFAULT 'The latest on SEO tools, tips, and strategy.',
  posts_per_page INT NOT NULL DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_settings TO anon, authenticated;
GRANT ALL ON public.blog_settings TO service_role;
GRANT INSERT, UPDATE ON public.blog_settings TO authenticated;
ALTER TABLE public.blog_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Blog settings are public" ON public.blog_settings FOR SELECT USING (true);
CREATE POLICY "Admins manage blog settings" ON public.blog_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_blog_settings_updated BEFORE UPDATE ON public.blog_settings FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.blog_settings (comments_enabled) VALUES (true);


-- =============================================================
-- migration: 20260717184925_351ca486-a115-47aa-83b6-5255ebefbb17.sql
-- =============================================================


CREATE TABLE public.ai_generator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'google',
  model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  default_language text NOT NULL DEFAULT 'English',
  default_country text,
  default_tone text NOT NULL DEFAULT 'Informative',
  default_audience text NOT NULL DEFAULT 'General readers',
  default_reading_level text NOT NULL DEFAULT 'Intermediate',
  default_writing_style text NOT NULL DEFAULT 'Blog',
  default_length text NOT NULL DEFAULT 'Long (2000-2500 words)',
  brand_voice text,
  singleton boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_generator_settings_singleton_uniq UNIQUE (singleton)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_generator_settings TO authenticated;
GRANT ALL ON public.ai_generator_settings TO service_role;

ALTER TABLE public.ai_generator_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read AI generator settings"
  ON public.ai_generator_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert AI generator settings"
  ON public.ai_generator_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update AI generator settings"
  ON public.ai_generator_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ai_generator_settings_updated_at
  BEFORE UPDATE ON public.ai_generator_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the singleton row
INSERT INTO public.ai_generator_settings (provider, model) VALUES ('google', 'google/gemini-3-flash-preview')
ON CONFLICT DO NOTHING;


-- =============================================================
-- migration: 20260717190730_f3af6238-408a-4389-bb5c-d07d04736cec.sql
-- =============================================================


-- Extend blog_posts
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS og_title text,
  ADD COLUMN IF NOT EXISTS og_description text,
  ADD COLUMN IF NOT EXISTS og_image text,
  ADD COLUMN IF NOT EXISTS twitter_title text,
  ADD COLUMN IF NOT EXISTS twitter_description text,
  ADD COLUMN IF NOT EXISTS twitter_image text,
  ADD COLUMN IF NOT EXISTS semantic_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_alts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cta_template_id uuid;

-- Extend blog_settings for editor prefs
ALTER TABLE public.blog_settings
  ADD COLUMN IF NOT EXISTS keyword_highlight_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS keyword_highlight_color text NOT NULL DEFAULT '#fde68a';

-- CTA templates
CREATE TABLE IF NOT EXISTS public.blog_cta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  button_label text NOT NULL,
  button_url text NOT NULL,
  target_tool_slugs text[] NOT NULL DEFAULT '{}',
  target_category_slugs text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.blog_cta_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_cta_templates TO authenticated;
GRANT ALL ON public.blog_cta_templates TO service_role;

ALTER TABLE public.blog_cta_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cta_public_read"
  ON public.blog_cta_templates FOR SELECT
  USING (true);

CREATE POLICY "cta_admin_insert"
  ON public.blog_cta_templates FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "cta_admin_update"
  ON public.blog_cta_templates FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "cta_admin_delete"
  ON public.blog_cta_templates FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER blog_cta_templates_touch
  BEFORE UPDATE ON public.blog_cta_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed a sensible default CTA (only if none exist)
INSERT INTO public.blog_cta_templates (name, title, body, button_label, button_url, priority, is_default)
SELECT
  'Default subscription CTA',
  'Get instant access to premium SEO tools',
  'Skip the individual subscriptions. Access Stealthwriter, Phrasly, Quillbot, Grammarly, Semrush and more at a fraction of the cost.',
  'View pricing',
  '/pricing',
  0,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.blog_cta_templates);


-- =============================================================
-- migration: 20260718122618_4e062c91-b69b-4cfa-96ec-6cd29481559f.sql
-- =============================================================


-- Trigger-only functions: revoke all direct execute
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- RLS helper functions: revoke from anon/public, keep authenticated (used in policies)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_tool_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tool_access(uuid, text) TO authenticated;


-- =============================================================
-- migration: 20260718123903_ab38e1de-9cc6-43c8-baed-c21baa24cd87.sql
-- =============================================================

-- Featured image metadata
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS featured_image_source TEXT DEFAULT 'manual' CHECK (featured_image_source IN ('ai','stock','upload','manual')),
  ADD COLUMN IF NOT EXISTS featured_image_alt TEXT,
  ADD COLUMN IF NOT EXISTS featured_image_credit TEXT;

-- Blog settings: default image provider
ALTER TABLE public.blog_settings
  ADD COLUMN IF NOT EXISTS default_image_provider TEXT DEFAULT 'ai' CHECK (default_image_provider IN ('ai','stock','manual')),
  ADD COLUMN IF NOT EXISTS ai_image_model TEXT DEFAULT 'openai/gpt-image-2';

-- Full-text search index for keyword blog search
CREATE INDEX IF NOT EXISTS blog_posts_fts_idx ON public.blog_posts
  USING GIN (to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,'')));

-- Storage policies for blog-images (bucket already created)
DROP POLICY IF EXISTS "Public can read blog images" ON storage.objects;
CREATE POLICY "Public can read blog images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'blog-images');

DROP POLICY IF EXISTS "Admins can upload blog images" ON storage.objects;
CREATE POLICY "Admins can upload blog images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'blog-images' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update blog images" ON storage.objects;
CREATE POLICY "Admins can update blog images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'blog-images' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete blog images" ON storage.objects;
CREATE POLICY "Admins can delete blog images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'blog-images' AND public.has_role(auth.uid(), 'admin'));


-- =============================================================
-- migration: 20260718130304_b19ee651-202b-4045-9b71-38467d9f1c15.sql
-- =============================================================


ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS one_click_auth_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS official_login_url TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT,
  ADD COLUMN IF NOT EXISTS launch_mode TEXT NOT NULL DEFAULT 'new_tab',
  ADD COLUMN IF NOT EXISTS display_manual_credentials BOOLEAN NOT NULL DEFAULT true;


-- =============================================================
-- migration: 20260718143319_150cd5d1-f548-4de7-9a0c-fe04212cf295.sql
-- =============================================================


-- Hide commenter emails from public reads. Drop the public SELECT policy on the base table and expose a safe view instead.
DROP POLICY IF EXISTS "Approved comments are public" ON public.blog_comments;

CREATE OR REPLACE VIEW public.blog_comments_public
WITH (security_invoker = on) AS
SELECT id, post_id, author_name, content, status, created_at
FROM public.blog_comments
WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;

-- Re-add a restricted public SELECT policy scoped so anon can only read approved rows through the view (view runs as invoker, so base-table SELECT is still needed).
CREATE POLICY "Approved comments readable for view"
ON public.blog_comments
FOR SELECT
TO anon, authenticated
USING (status = 'approved');


-- =============================================================
-- migration: 20260718143337_92d8e742-71a6-4f0e-8084-0c600c8a2aa8.sql
-- =============================================================


-- Remove anon SELECT on the base table so author_email cannot be queried directly.
DROP POLICY IF EXISTS "Approved comments readable for view" ON public.blog_comments;

-- Recreate the view as SECURITY DEFINER-equivalent by owning it as postgres and using security_invoker=off,
-- so anon reads via the view bypass base-table RLS while direct base-table access stays admin-only.
DROP VIEW IF EXISTS public.blog_comments_public;
CREATE VIEW public.blog_comments_public
WITH (security_invoker = off) AS
SELECT id, post_id, author_name, content, status, created_at
FROM public.blog_comments
WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;


-- =============================================================
-- migration: 20260718143352_49547384-45cd-4932-a405-ea247eec2b58.sql
-- =============================================================


DROP VIEW IF EXISTS public.blog_comments_public;
-- No public SELECT policy: only admins can read the base table directly.
-- Approved comments are served to visitors by a server function using a trusted server client.
REVOKE SELECT ON public.blog_comments FROM anon;


-- =============================================================
-- migration: 20260718144049_896da2a9-4ba5-42e7-8e34-1725bbf89021.sql
-- =============================================================

UPDATE public.blog_posts SET status = 'draft' WHERE slug = 'audit-test-post';


-- =============================================================
-- migration: 20260718151727_cb808f88-5c17-4a15-bd54-9097f7d020f9.sql
-- =============================================================


ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS badge text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tool_pricing_access_type_check'
  ) THEN
    ALTER TABLE public.tool_pricing
      ADD CONSTRAINT tool_pricing_access_type_check
      CHECK (access_type IN ('shared','private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tool_pricing_tool_access_idx
  ON public.tool_pricing (tool_slug, access_type, enabled);


-- =============================================================
-- migration: 20260718152948_b86f9fb2-17e6-4598-b15b-756cac72d974.sql
-- =============================================================

ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS shared_access_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS private_access_enabled boolean NOT NULL DEFAULT true;


-- =============================================================
-- migration: 20260718165213_52060125-4652-4138-b9a6-dd29b2b3fe4a.sql
-- =============================================================


-- =========================================================================
-- Phase 1B: Non-destructive recurring-billing schema foundation
-- All changes are additive. No existing data, columns, enums, or policies
-- are removed or renamed.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. tool_pricing: add billing_period (monthly / quarterly / yearly)
-- -------------------------------------------------------------------------
ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS billing_period text
    CHECK (billing_period IS NULL OR billing_period IN ('monthly','quarterly','yearly'));

-- Backfill only unambiguous durations. Leave others null.
UPDATE public.tool_pricing SET billing_period = 'monthly'   WHERE billing_period IS NULL AND duration_days = 28;
UPDATE public.tool_pricing SET billing_period = 'quarterly' WHERE billing_period IS NULL AND duration_days = 90;
UPDATE public.tool_pricing SET billing_period = 'yearly'    WHERE billing_period IS NULL AND duration_days = 365;

-- -------------------------------------------------------------------------
-- 2. tool_orders: additive classification + recurring/pay-per-unit fields
-- -------------------------------------------------------------------------
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS access_type text
    CHECK (access_type IS NULL OR access_type IN ('shared','private')),
  ADD COLUMN IF NOT EXISTS billing_period text
    CHECK (billing_period IS NULL OR billing_period IN ('monthly','quarterly','yearly')),
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'legacy_one_time'
    CHECK (payment_type IN ('legacy_one_time','one_time','recurring_subscription','pay_per_unit')),
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'subscription'
    CHECK (product_type IN ('subscription','service')),
  ADD COLUMN IF NOT EXISTS paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','processing','successful','failed','requires_review','refunded','reversed')),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (subscription_status IN ('not_applicable','pending','active','past_due','non_renewing','expired','cancelled','suspended')),
  ADD COLUMN IF NOT EXISTS fulfilment_status text NOT NULL DEFAULT 'not_required'
    CHECK (fulfilment_status IN ('not_required','pending','active','failed','expired')),
  ADD COLUMN IF NOT EXISTS renewal_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (renewal_status IN ('not_applicable','enabled','disable_pending','disabled')),
  -- Recurring-subscription storage (nullable, unused for existing rows)
  ADD COLUMN IF NOT EXISTS paystack_customer_code text,
  ADD COLUMN IF NOT EXISTS paystack_subscription_code text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS paid_through_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_at timestamptz,
  ADD COLUMN IF NOT EXISTS non_renewal_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_disabled_at timestamptz,
  -- Pay-per-unit fields (nullable)
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS unit_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS verified_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS service_status text;

-- Backfill access_type + billing_period from linked pricing row, only when unambiguous.
UPDATE public.tool_orders o
SET access_type = p.access_type
FROM public.tool_pricing p
WHERE o.pricing_option_id = p.id
  AND o.access_type IS NULL
  AND p.access_type IN ('shared','private');

UPDATE public.tool_orders o
SET billing_period = p.billing_period
FROM public.tool_pricing p
WHERE o.pricing_option_id = p.id
  AND o.billing_period IS NULL
  AND p.billing_period IS NOT NULL;

-- Backfill payment_status for terminal statuses on existing legacy orders.
UPDATE public.tool_orders SET payment_status = 'successful' WHERE status = 'approved' AND payment_status = 'pending';
UPDATE public.tool_orders SET payment_status = 'failed'     WHERE status = 'rejected' AND payment_status = 'pending';

CREATE INDEX IF NOT EXISTS tool_orders_subscription_code_idx
  ON public.tool_orders (paystack_subscription_code)
  WHERE paystack_subscription_code IS NOT NULL;

-- -------------------------------------------------------------------------
-- 3. tool_payments: per-transaction payment history
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  paystack_reference text,
  paystack_transaction_id text,
  paystack_invoice_code text,
  payment_type text NOT NULL DEFAULT 'one_time'
    CHECK (payment_type IN ('legacy_one_time','one_time','recurring_subscription','pay_per_unit')),
  classification text NOT NULL DEFAULT 'initial'
    CHECK (classification IN ('initial','renewal','one_time','refund','reversal')),
  amount numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN',
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','processing','successful','failed','requires_review','refunded','reversed')),
  paid_at timestamptz,
  paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_payments TO authenticated;
GRANT ALL ON public.tool_payments TO service_role;

ALTER TABLE public.tool_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments owner select" ON public.tool_payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "payments admin write" ON public.tool_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS tool_payments_user_idx ON public.tool_payments (user_id);
CREATE INDEX IF NOT EXISTS tool_payments_order_idx ON public.tool_payments (order_id);
CREATE INDEX IF NOT EXISTS tool_payments_ref_idx ON public.tool_payments (paystack_reference);

CREATE TRIGGER trg_tool_payments_updated
  BEFORE UPDATE ON public.tool_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 4. paystack_customers: per-environment customer mapping
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paystack_environment text NOT NULL
    CHECK (paystack_environment IN ('test','live')),
  paystack_customer_code text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, paystack_environment)
);

GRANT SELECT ON public.paystack_customers TO authenticated;
GRANT ALL ON public.paystack_customers TO service_role;

ALTER TABLE public.paystack_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paystack_customers owner select" ON public.paystack_customers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "paystack_customers admin write" ON public.paystack_customers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_paystack_customers_updated
  BEFORE UPDATE ON public.paystack_customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 5. paystack_plan_mappings: versioned per-pricing plan codes
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_plan_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pricing_option_id uuid REFERENCES public.tool_pricing(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  billing_period text NOT NULL CHECK (billing_period IN ('monthly','quarterly','yearly')),
  paystack_environment text NOT NULL CHECK (paystack_environment IN ('test','live')),
  paystack_plan_code text,
  amount_snapshot numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN',
  paystack_interval text,
  active_for_new_purchases boolean NOT NULL DEFAULT false,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending','synced','error','superseded')),
  sync_error text,
  last_verified_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.paystack_plan_mappings TO authenticated;
GRANT ALL ON public.paystack_plan_mappings TO service_role;

ALTER TABLE public.paystack_plan_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_mappings admin all" ON public.paystack_plan_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS plan_mappings_lookup_idx
  ON public.paystack_plan_mappings (tool_slug, access_type, billing_period, paystack_environment, active_for_new_purchases);

CREATE TRIGGER trg_plan_mappings_updated
  BEFORE UPDATE ON public.paystack_plan_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 6. paystack_webhook_events: idempotent event log (prep only; no processing)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  transaction_reference text,
  subscription_code text,
  invoice_code text,
  paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed','skipped')),
  processing_attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.paystack_webhook_events TO service_role;
-- Customers cannot read webhook events. Admins access via service_role or the admin dashboard.

ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events admin select" ON public.paystack_webhook_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No write policies for authenticated role: only service_role can insert/update.

CREATE INDEX IF NOT EXISTS webhook_events_ref_idx ON public.paystack_webhook_events (transaction_reference);
CREATE INDEX IF NOT EXISTS webhook_events_sub_idx ON public.paystack_webhook_events (subscription_code);

CREATE TRIGGER trg_webhook_events_updated
  BEFORE UPDATE ON public.paystack_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- =============================================================
-- migration: 20260720113835_7d04b0b1-2f89-4465-8ef2-b3ac9ca53045.sql
-- =============================================================


-- Phase 3: Admin WhatsApp number for Private fulfilment and 6-hour fulfilment tracking columns.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS admin_whatsapp_number TEXT;

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS fulfilment_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilment_marked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS fulfilment_reason TEXT;

CREATE INDEX IF NOT EXISTS tool_orders_fulfilment_deadline_idx
  ON public.tool_orders (fulfilment_deadline_at)
  WHERE fulfilment_status = 'pending';


-- =============================================================
-- migration: 20260720114519_57926a65-9a4f-47ca-9fb3-f75d154933ce.sql
-- =============================================================


CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'auto-fulfil-private-orders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/auto-fulfil-private',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- =============================================================
-- migration: 20260720120934_7d5df724-0f24-4fe3-94ef-7ea92f41fb9e.sql
-- =============================================================


-- Internal secrets table (service role only; RLS on with no policies).
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_secrets TO service_role;
REVOKE ALL ON public.internal_secrets FROM anon, authenticated;

ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (which bypasses RLS) can read/write.


-- =============================================================
-- migration: 20260721002028_82623b3f-58c0-41fc-ba95-aebedc8f9946.sql
-- =============================================================

UPDATE public.tool_pricing SET enabled = true WHERE enabled = false AND contact_admin = false AND amount IS NOT NULL AND amount > 0;


-- =============================================================
-- migration: 20260721012513_8777e593-0582-4c4f-9c8f-bfead2634edf.sql
-- =============================================================

UPDATE public.ai_generator_settings SET model = 'gemini-2.5-flash' WHERE provider = 'google' AND model NOT IN ('gemini-2.5-flash','gemini-2.5-pro','gemini-2.5-flash-lite','gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-flash','gemini-1.5-pro');


-- =============================================================
-- migration: 20260721012659_e7dbabf9-984b-462e-9152-f6986fae85ff.sql
-- =============================================================

UPDATE public.ai_generator_settings SET model = 'gemini-flash-latest' WHERE provider = 'google' AND model NOT IN ('gemini-flash-latest','gemini-flash-lite-latest','gemini-pro-latest','gemini-3.5-flash','gemini-3-flash-preview','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-flash-lite');


-- =============================================================
-- migration: 20260721014123_9dcf5336-4a09-4813-bfd1-429356113945.sql
-- =============================================================


ALTER TABLE public.ai_generator_settings
  ADD COLUMN IF NOT EXISTS brand_name text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS brand_url text NOT NULL DEFAULT 'https://topratedseotools.lovable.app',
  ADD COLUMN IF NOT EXISTS brand_description text NOT NULL DEFAULT 'Affordable access to premium SEO, AI, writing, research and productivity tools with Shared and Private Access plans (monthly, quarterly, yearly) via secure Paystack payments and a simple customer dashboard.',
  ADD COLUMN IF NOT EXISTS promo_position integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS promo_tone text NOT NULL DEFAULT 'Natural, professional and persuasive',
  ADD COLUMN IF NOT EXISTS promo_enabled boolean NOT NULL DEFAULT true;


-- =============================================================
-- migration: 20260721015914_070a4d71-0934-4c1d-9b31-98916d3edf0f.sql
-- =============================================================


-- 1) Extend user_roles with active + super-admin flags
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 2) Update has_role to respect is_active (keeps existing signature/callers)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND is_active = true
  );
$$;

-- 3) Super-admin helper
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND is_super_admin = true
      AND is_active = true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- 4) Lock user_roles management to Super Admin only
DROP POLICY IF EXISTS "admins manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users read own role" ON public.user_roles;

-- Users may read only their own role rows (needed by client isAdmin checks)
CREATE POLICY "user_roles_read_own"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Super admin may read all admin rows (for admin management UI)
CREATE POLICY "user_roles_super_admin_read_all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Only super admin may insert/update/delete admin rows
CREATE POLICY "user_roles_super_admin_insert"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles_super_admin_update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles_super_admin_delete"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    -- prevent deleting the last super admin
    AND NOT (is_super_admin = true
             AND (SELECT count(*) FROM public.user_roles WHERE role='admin' AND is_super_admin=true AND is_active=true) <= 1)
  );

-- 5) Guard triggers: prevent last super-admin from being demoted/deactivated
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining int;
BEGIN
  IF (TG_OP = 'UPDATE'
      AND OLD.is_super_admin = true
      AND (NEW.is_super_admin = false OR NEW.is_active = false)) THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last super admin';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_last_super_admin ON public.user_roles;
CREATE TRIGGER trg_protect_last_super_admin
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- 6) Promote the existing owner to Super Admin
UPDATE public.user_roles
   SET is_super_admin = true, is_active = true
 WHERE user_id = '7be067d4-4168-47a1-b3a9-9af9bac4326b'
   AND role = 'admin';


-- =============================================================
-- migration: 20260721020507_e87d22fd-9475-43e6-bd98-37f9dd6b5600.sql
-- =============================================================

REVOKE EXECUTE ON FUNCTION public.protect_last_super_admin() FROM PUBLIC, anon, authenticated;


-- =============================================================
-- migration: 20260721021146_ee519bf4-c9f4-40bf-ba86-bc343625d163.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS public.admin_accounts (
  user_id uuid PRIMARY KEY,
  email text,
  full_name text,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_accounts TO authenticated;
GRANT ALL ON public.admin_accounts TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_email_lower_idx
  ON public.admin_accounts (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can view admin accounts"
ON public.admin_accounts
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can create admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can create admin accounts"
ON public.admin_accounts
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can update admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can update admin accounts"
ON public.admin_accounts
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can delete admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can delete admin accounts"
ON public.admin_accounts
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_admin_accounts_touch_updated_at ON public.admin_accounts;
CREATE TRIGGER trg_admin_accounts_touch_updated_at
BEFORE UPDATE ON public.admin_accounts
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.admin_accounts (user_id, email, full_name)
SELECT ur.user_id, p.email, p.full_name
FROM public.user_roles ur
LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'admin'
ON CONFLICT (user_id) DO UPDATE SET
  email = COALESCE(EXCLUDED.email, public.admin_accounts.email),
  full_name = COALESCE(EXCLUDED.full_name, public.admin_accounts.full_name),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.ensure_admin_role_registered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.admin_accounts aa
      WHERE aa.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Admin role can only be assigned to a registered Admin account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_role_registered() TO service_role;

DROP TRIGGER IF EXISTS trg_user_roles_admin_registry ON public.user_roles;
CREATE TRIGGER trg_user_roles_admin_registry
BEFORE INSERT OR UPDATE OF user_id, role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_role_registered();


-- =============================================================
-- migration: 20260721021349_d4996f7f-0e53-46a2-aed2-f7fd5326f154.sql
-- =============================================================

ALTER TABLE public.admin_accounts
  ADD COLUMN IF NOT EXISTS account_email text;

UPDATE public.admin_accounts
SET account_email = lower(trim(coalesce(account_email, email)))
WHERE account_email IS NULL
  AND email IS NOT NULL;

ALTER TABLE public.admin_accounts
  ALTER COLUMN account_email SET NOT NULL;

DROP INDEX IF EXISTS public.admin_accounts_email_lower_idx;
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_account_email_key
  ON public.admin_accounts (account_email);

CREATE OR REPLACE FUNCTION public.ensure_admin_role_registered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.admin_accounts aa
      WHERE aa.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Admin role can only be assigned to a registered Admin account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_role_registered() TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_admin_account_is_not_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized_email text;
BEGIN
  normalized_email := lower(trim(coalesce(NEW.account_email, NEW.email)));
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RAISE EXCEPTION 'Admin email is required';
  END IF;

  NEW.account_email := normalized_email;
  NEW.email := normalized_email;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(trim(p.email)) = normalized_email
      AND p.id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'This email is already registered as a customer. Please use a different email address for the Admin account.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_account_is_not_customer() TO service_role;

DROP TRIGGER IF EXISTS trg_admin_accounts_not_customer ON public.admin_accounts;
CREATE TRIGGER trg_admin_accounts_not_customer
BEFORE INSERT OR UPDATE OF user_id, email, account_email ON public.admin_accounts
FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_account_is_not_customer();


-- =============================================================
-- migration: 20260721021719_6fa7f1f2-c348-433c-a4ef-1f5de1a863c8.sql
-- =============================================================

REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_account_is_not_customer() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_role_registered() TO service_role;


-- =============================================================
-- migration: 20260721025922_70e882f9-790e-461b-8a38-24c344e885b7.sql
-- =============================================================


-- 1. Extend tool_orders with offline / admin-origin fields
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS created_by_admin uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

DO $$ BEGIN
  ALTER TABLE public.tool_orders
    ADD CONSTRAINT tool_orders_origin_check
    CHECK (origin IN ('paystack','offline'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend tool_payments with offline metadata
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reference_note text,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES auth.users(id);

DO $$ BEGIN
  ALTER TABLE public.tool_payments
    ADD CONSTRAINT tool_payments_source_check
    CHECK (source IN ('paystack','offline'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tool_payments
    ADD CONSTRAINT tool_payments_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN (
      'bank_transfer','cash','whatsapp','other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Relax paystack_environment check to allow 'offline' marker
ALTER TABLE public.tool_payments
  DROP CONSTRAINT IF EXISTS tool_payments_paystack_environment_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_paystack_environment_check
  CHECK (paystack_environment IN ('legacy','test','live','offline'));

ALTER TABLE public.tool_orders
  DROP CONSTRAINT IF EXISTS tool_orders_paystack_environment_check;
ALTER TABLE public.tool_orders
  ADD CONSTRAINT tool_orders_paystack_environment_check
  CHECK (paystack_environment IN ('legacy','test','live','offline'));

-- 3. Admin-only per-customer metadata (phone, notes)
CREATE TABLE IF NOT EXISTS public.customer_admin_meta (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text,
  admin_notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_admin_meta TO authenticated;
GRANT ALL ON public.customer_admin_meta TO service_role;

ALTER TABLE public.customer_admin_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin meta read" ON public.customer_admin_meta;
CREATE POLICY "admin meta read"
  ON public.customer_admin_meta
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin meta write" ON public.customer_admin_meta;
CREATE POLICY "admin meta write"
  ON public.customer_admin_meta
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_customer_admin_meta_updated ON public.customer_admin_meta;
CREATE TRIGGER trg_customer_admin_meta_updated
  BEFORE UPDATE ON public.customer_admin_meta
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. Admin audit log for customer actions
CREATE TABLE IF NOT EXISTS public.customer_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.tool_payments(id) ON DELETE SET NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_admin_audit_customer_idx
  ON public.customer_admin_audit(customer_id, created_at DESC);

GRANT SELECT, INSERT ON public.customer_admin_audit TO authenticated;
GRANT ALL ON public.customer_admin_audit TO service_role;

ALTER TABLE public.customer_admin_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit admin read" ON public.customer_admin_audit;
CREATE POLICY "audit admin read"
  ON public.customer_admin_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "audit admin write" ON public.customer_admin_audit;
CREATE POLICY "audit admin write"
  ON public.customer_admin_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));


-- =============================================================
-- migration: 20260721031320_d6375343-e935-4ff9-93d5-e2ee18e7ebfc.sql
-- =============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;


-- =============================================================
-- migration: 20260721033024_fbb7c050-7a44-4976-bc6c-7f3bd11c6eaa.sql
-- =============================================================


-- Transactions & receipts foundation.
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_channel text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS access_type text,
  ADD COLUMN IF NOT EXISTS billing_period text,
  ADD COLUMN IF NOT EXISTS price_label text,
  ADD COLUMN IF NOT EXISTS paystack_status text,
  ADD COLUMN IF NOT EXISTS paystack_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_last_status text,
  ADD COLUMN IF NOT EXISTS receipt_last_error text,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reconciliation_note text,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_reason text,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz;

-- Widen payment_status enum to include the statuses receipts need.
ALTER TABLE public.tool_payments
  DROP CONSTRAINT IF EXISTS tool_payments_payment_status_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'initiated','pending','processing','successful','failed',
    'requires_review','refunded','reversed','abandoned'
  ]));

ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_reconciliation_check
  CHECK (reconciliation_status = ANY (ARRAY['none','open','investigating','resolved','refunded']));

-- One canonical row per Paystack reference (nullable for offline manual rows).
CREATE UNIQUE INDEX IF NOT EXISTS tool_payments_paystack_reference_unique
  ON public.tool_payments (paystack_reference)
  WHERE paystack_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS tool_payments_status_idx
  ON public.tool_payments (payment_status);
CREATE INDEX IF NOT EXISTS tool_payments_recon_idx
  ON public.tool_payments (reconciliation_status)
  WHERE reconciliation_status <> 'none';

-- Status history: append-only audit trail.
CREATE TABLE IF NOT EXISTS public.tool_payment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.tool_payments(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  source text NOT NULL, -- checkout | webhook | verify | recheck | admin | system
  paystack_status text,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_payment_status_history TO authenticated;
GRANT ALL ON public.tool_payment_status_history TO service_role;

ALTER TABLE public.tool_payment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history owner or admin select" ON public.tool_payment_status_history
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.tool_payments p
      WHERE p.id = payment_id AND p.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS tool_payment_status_history_payment_idx
  ON public.tool_payment_status_history(payment_id, created_at DESC);


-- =============================================================
-- migration: 20260721040644_6205ff5f-beed-424f-9c8b-03fbdaa27ba9.sql
-- =============================================================


-- =========================================================================
-- email_settings (singleton row, id = true)
-- =========================================================================
CREATE TABLE public.email_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  sender_name TEXT NOT NULL DEFAULT 'Top Rated SEO Tools',
  from_email TEXT NOT NULL DEFAULT 'support@topratedseotools.com',
  reply_to_email TEXT NOT NULL DEFAULT 'support@topratedseotools.com',
  sending_domain TEXT NOT NULL DEFAULT 'topratedseotools.com',
  abandoned_delay_hours INTEGER NOT NULL DEFAULT 24 CHECK (abandoned_delay_hours >= 0 AND abandoned_delay_hours <= 720),
  enabled_types JSONB NOT NULL DEFAULT '{
    "payment_success": true,
    "payment_failed": true,
    "abandoned_checkout": true,
    "offline_confirmed": true,
    "private_pending": true,
    "private_fulfilled": true,
    "renewal_success": true,
    "renewal_failed": true,
    "renewal_disabled": true,
    "customer_invite": true
  }'::jsonb,
  production_sending BOOLEAN NOT NULL DEFAULT false,
  resend_domain_id TEXT,
  resend_domain_status TEXT NOT NULL DEFAULT 'unconfigured',
  resend_dns_records JSONB,
  last_verified_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email settings" ON public.email_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update email settings" ON public.email_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert email settings" ON public.email_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the singleton row
INSERT INTO public.email_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- =========================================================================
-- email_templates
-- =========================================================================
CREATE TABLE public.email_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email templates" ON public.email_templates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed default templates
INSERT INTO public.email_templates (key, name, subject, html_body) VALUES
('payment_success', 'Payment successful', 'Payment received — {{tool}} access is active',
'<p>Hi {{name}},</p><p>Your payment of <strong>{{currency}} {{amount}}</strong> for <strong>{{tool}}</strong> ({{access_type}}, {{billing_period}}) was successful.</p><p>Reference: {{reference}}<br/>Access starts: {{start_date}}<br/>Expires: {{expiry_date}}</p><p><a href="{{dashboard_url}}">Open your dashboard</a></p><p>— Top Rated SEO Tools</p>'),
('payment_failed', 'Payment failed', 'We couldn''t process your payment for {{tool}}',
'<p>Hi {{name}},</p><p>Unfortunately your payment for <strong>{{tool}}</strong> could not be processed.</p><p>Reference: {{reference}}<br/>Reason: {{reason}}</p><p><a href="{{retry_url}}">Try again</a> or contact us at {{reply_to}}.</p><p>— Top Rated SEO Tools</p>'),
('abandoned_checkout', 'Complete your checkout', 'Still interested in {{tool}}?',
'<p>Hi {{name}},</p><p>You started checkout for <strong>{{tool}}</strong> ({{access_type}}, {{billing_period}} — {{currency}} {{amount}}) but didn''t finish.</p><p><a href="{{resume_url}}">Resume checkout</a></p><p>Need help? Reply to this email.</p><p>— Top Rated SEO Tools</p>'),
('offline_confirmed', 'Offline payment recorded', 'Access confirmed — {{tool}}',
'<p>Hi {{name}},</p><p>We''ve recorded your one-time payment for <strong>{{tool}}</strong>.</p><ul><li>Access: {{access_type}}</li><li>Billing: {{billing_period}}</li><li>Amount: {{currency}} {{amount}}</li><li>Method: {{payment_method}}</li><li>Start: {{start_date}}</li><li>Expiry: {{expiry_date}}</li><li>Auto-renew: {{auto_renew}}</li></ul><p><a href="{{dashboard_url}}">Open your dashboard</a></p><p>— Top Rated SEO Tools</p>'),
('private_pending', 'Private Access — payment received', 'Payment received — Private Access setup in progress',
'<p>Hi {{name}},</p><p>Payment successful for <strong>{{tool}}</strong> (Private Access, {{billing_period}} — {{currency}} {{amount}}).</p><p>Your dedicated credentials are being prepared and will be delivered by <strong>{{fulfil_by}}</strong>.</p><p>{{contact_admin_line}}</p><p>— Top Rated SEO Tools</p>'),
('private_fulfilled', 'Private Access is ready', 'Your Private Access for {{tool}} is ready',
'<p>Hi {{name}},</p><p>Your Private Access credentials for <strong>{{tool}}</strong> are now available in your dashboard.</p><p><a href="{{dashboard_url}}">Launch tool</a></p><p>— Top Rated SEO Tools</p>'),
('renewal_success', 'Subscription renewed', 'Your {{tool}} subscription renewed',
'<p>Hi {{name}},</p><p>Your subscription for <strong>{{tool}}</strong> renewed successfully. Next billing: {{next_billing_date}}.</p><p>— Top Rated SEO Tools</p>'),
('renewal_failed', 'Renewal failed', 'Renewal failed for {{tool}}',
'<p>Hi {{name}},</p><p>We could not renew your <strong>{{tool}}</strong> subscription. Please update your payment method.</p><p><a href="{{billing_url}}">Manage billing</a></p><p>— Top Rated SEO Tools</p>'),
('renewal_disabled', 'Auto-renewal disabled', 'Auto-renewal turned off for {{tool}}',
'<p>Hi {{name}},</p><p>Auto-renewal for <strong>{{tool}}</strong> is now off. Your access continues until {{expiry_date}}.</p><p>— Top Rated SEO Tools</p>'),
('customer_invite', 'Your account is ready', 'Your Top Rated SEO Tools account is ready',
'<p>Hi {{name}},</p><p>An account has been created for you at Top Rated SEO Tools.</p><p><a href="{{setup_url}}">Set your password and sign in</a></p><p>For your security, we don''t include passwords in email.</p><p>— Top Rated SEO Tools</p>')
ON CONFLICT (key) DO NOTHING;

-- =========================================================================
-- email_messages (idempotency + queue + history)
-- =========================================================================
CREATE TABLE public.email_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  template_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  related_order_id UUID,
  related_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','retrying','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  resend_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_messages_status_scheduled_idx
  ON public.email_messages (status, scheduled_for);
CREATE INDEX email_messages_recipient_idx
  ON public.email_messages (recipient);
CREATE INDEX email_messages_order_idx
  ON public.email_messages (related_order_id);
CREATE INDEX email_messages_created_idx
  ON public.email_messages (created_at DESC);

GRANT SELECT ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email messages" ON public.email_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update email messages" ON public.email_messages
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_messages_updated_at
  BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- =============================================================
-- migration: 20260721050651_0b58a96e-d9ab-416e-8531-3fc8365ec88f.sql
-- =============================================================


ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS shared_access_authorization text NOT NULL DEFAULT 'confirmed'
    CHECK (shared_access_authorization IN ('confirmed','not_confirmed','not_applicable')),
  ADD COLUMN IF NOT EXISTS private_access_authorization text NOT NULL DEFAULT 'confirmed'
    CHECK (private_access_authorization IN ('confirmed','not_confirmed','not_applicable'));


-- =============================================================
-- migration: 20260721053549_9c0e574d-c4a7-434b-afcc-e3fb30cd6d20.sql
-- =============================================================


-- Reviews: current version per user+tool + version history

CREATE TYPE public.review_status AS ENUM ('pending','approved','rejected','hidden');
CREATE TYPE public.review_source AS ENUM ('paystack','offline');

CREATE TABLE public.tool_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug text NOT NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL,
  body text NOT NULL,
  display_name text,
  status public.review_status NOT NULL DEFAULT 'pending',
  moderation_note text,
  verified_source public.review_source NOT NULL,
  qualifying_order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  version_no int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool_slug)
);

CREATE INDEX tool_reviews_slug_status_idx ON public.tool_reviews (tool_slug, status);

CREATE TABLE public.tool_review_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.tool_reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tool_slug text NOT NULL,
  rating int NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  display_name text,
  status public.review_status NOT NULL,
  qualifying_order_id uuid,
  version_no int NOT NULL,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_review_versions_review_idx ON public.tool_review_versions (review_id, version_no);

GRANT SELECT, INSERT, UPDATE ON public.tool_reviews TO authenticated;
GRANT SELECT ON public.tool_reviews TO anon;
GRANT ALL ON public.tool_reviews TO service_role;

GRANT SELECT, INSERT ON public.tool_review_versions TO authenticated;
GRANT ALL ON public.tool_review_versions TO service_role;

ALTER TABLE public.tool_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_review_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read approved reviews"
  ON public.tool_reviews FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE POLICY "Users read own reviews"
  ON public.tool_reviews FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all reviews"
  ON public.tool_reviews FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Users insert own review"
  ON public.tool_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own review"
  ON public.tool_reviews FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins update reviews"
  ON public.tool_reviews FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Users read own review versions"
  ON public.tool_review_versions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all review versions"
  ON public.tool_review_versions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Users insert own review version"
  ON public.tool_review_versions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_tool_reviews_updated_at
  BEFORE UPDATE ON public.tool_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Register review_request as an enabled email type + install template.
UPDATE public.email_settings
SET enabled_types = enabled_types || jsonb_build_object('review_request', true)
WHERE (enabled_types->>'review_request') IS NULL;

INSERT INTO public.email_templates (key, name, subject, html_body, enabled, is_system)
VALUES (
  'review_request',
  'Review request',
  'How is {{tool}} working for you?',
  '<p>Hi {{name}},</p><p>Thanks for purchasing <strong>{{tool}}</strong>. If you have a moment, please share a short review to help other customers.</p><p><a href="{{review_url}}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Write a review</a></p><p>Your review helps us keep improving.</p>',
  true,
  true
) ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- migration: 20260721060959_a14c1195-536e-48d0-accd-069256230031.sql
-- =============================================================


-- 1) marketing_integrations ---------------------------------------------------
CREATE TABLE public.marketing_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL UNIQUE CHECK (provider IN ('meta_pixel','meta_capi','gtm')),
  enabled boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  -- Public IDs (safe to expose): pixel id, gtm container id
  public_id text,
  -- Test event code for Meta (safe-ish; only used against test event API)
  test_event_code text,
  -- Free-form provider config (never store secrets here)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_at timestamptz,
  last_event_name text,
  last_error_at timestamptz,
  last_error_message text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_integrations TO authenticated;
GRANT ALL ON public.marketing_integrations TO service_role;
ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage marketing integrations"
  ON public.marketing_integrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_marketing_integrations_touch
  BEFORE UPDATE ON public.marketing_integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.marketing_integrations (provider, enabled) VALUES
  ('meta_pixel', false),
  ('meta_capi', false),
  ('gtm', false)
ON CONFLICT (provider) DO NOTHING;

-- 2) marketing_events ---------------------------------------------------------
CREATE TABLE public.marketing_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('meta','gtm','internal')),
  event_id text,
  source text NOT NULL CHECK (source IN ('browser','server')),
  status text NOT NULL CHECK (status IN ('sent','failed','skipped','deduplicated','pending')),
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_slug text,
  amount numeric,
  currency text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Deduplication key: same (platform, event_id) can never be "sent" twice.
CREATE UNIQUE INDEX marketing_events_dedupe_sent
  ON public.marketing_events (platform, event_id)
  WHERE event_id IS NOT NULL AND status = 'sent';
CREATE INDEX marketing_events_created_at_idx ON public.marketing_events (created_at DESC);
CREATE INDEX marketing_events_order_idx ON public.marketing_events (order_id);
GRANT SELECT ON public.marketing_events TO authenticated;
GRANT ALL ON public.marketing_events TO service_role;
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read marketing events"
  ON public.marketing_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) marketing_attribution ----------------------------------------------------
CREATE TABLE public.marketing_attribution (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  landing_page text,
  referrer text,
  first_touch jsonb,
  last_touch jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX marketing_attribution_visitor_key ON public.marketing_attribution (visitor_id);
CREATE INDEX marketing_attribution_user_idx ON public.marketing_attribution (user_id);
GRANT SELECT, INSERT, UPDATE ON public.marketing_attribution TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.marketing_attribution TO anon;
GRANT ALL ON public.marketing_attribution TO service_role;
ALTER TABLE public.marketing_attribution ENABLE ROW LEVEL SECURITY;
-- Anonymous visitors write their own row keyed by client-generated visitor_id.
-- Once a user signs in the server links user_id via service role.
CREATE POLICY "Attribution readable by admins"
  ON public.marketing_attribution FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());
CREATE POLICY "Anyone can seed attribution"
  ON public.marketing_attribution FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Anyone can update own attribution row"
  ON public.marketing_attribution FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 4) consent_choices ----------------------------------------------------------
CREATE TABLE public.consent_choices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  essential boolean NOT NULL DEFAULT true,
  analytics boolean NOT NULL DEFAULT false,
  marketing boolean NOT NULL DEFAULT false,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.consent_choices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.consent_choices TO anon;
GRANT ALL ON public.consent_choices TO service_role;
ALTER TABLE public.consent_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consent readable by owner or admin"
  ON public.consent_choices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());
CREATE POLICY "Anyone can insert consent"
  ON public.consent_choices FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Anyone can update consent"
  ON public.consent_choices FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);
CREATE TRIGGER trg_consent_choices_touch
  BEFORE UPDATE ON public.consent_choices
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 5) tool_orders.attribution --------------------------------------------------
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS attribution jsonb;

-- 6) site_settings.marketing_pause -------------------------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS marketing_pause boolean NOT NULL DEFAULT false;


-- =============================================================
-- migration: 20260721061022_baf92bcf-99ae-4f72-b12f-519defebf254.sql
-- =============================================================


-- Remove overly permissive anon INSERT/UPDATE policies. Attribution + consent
-- are now written exclusively by server functions that use the service role
-- (which bypasses RLS), so anon needs no write access.
DROP POLICY IF EXISTS "Anyone can seed attribution" ON public.marketing_attribution;
DROP POLICY IF EXISTS "Anyone can update own attribution row" ON public.marketing_attribution;
DROP POLICY IF EXISTS "Anyone can insert consent" ON public.consent_choices;
DROP POLICY IF EXISTS "Anyone can update consent" ON public.consent_choices;

REVOKE INSERT, UPDATE ON public.marketing_attribution FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.consent_choices FROM anon, authenticated;

-- Add a no-op deny policy on marketing_events so the linter recognises the
-- deliberate "service-role writes only, admins read" pattern.
CREATE POLICY "Nobody writes marketing events from the app"
  ON public.marketing_events FOR INSERT TO authenticated
  WITH CHECK (false);


-- =============================================================
-- migration: 20260721123048_0486dcc7-bcfb-4b1a-a520-bf4ac01b889e.sql
-- =============================================================


-- =========================================================================
-- 1. tool_accounts
-- =========================================================================
CREATE TABLE public.tool_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  label text NOT NULL DEFAULT '',
  login_email text,
  login_password text,
  login_url text,
  login_notes text,
  one_click_login_url text,
  max_capacity integer NOT NULL DEFAULT 1 CHECK (max_capacity >= 1),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'working'
    CHECK (status IN ('working','login_failed','password_changed','suspended','expired','tool_unavailable','maintenance','other')),
  enabled boolean NOT NULL DEFAULT true,
  needs_capacity_review boolean NOT NULL DEFAULT false,
  last_health_check_at timestamptz,
  last_health_check_by uuid REFERENCES auth.users(id),
  last_health_check_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX tool_accounts_tool_idx ON public.tool_accounts(tool_slug, access_type);
CREATE INDEX tool_accounts_status_idx ON public.tool_accounts(status) WHERE enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_accounts TO authenticated;
GRANT ALL ON public.tool_accounts TO service_role;
ALTER TABLE public.tool_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tool_accounts admin all" ON public.tool_accounts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TRIGGER tool_accounts_touch BEFORE UPDATE ON public.tool_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================================
-- 2. tool_account_assignments
-- =========================================================================
CREATE TABLE public.tool_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tool_accounts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','reassigned')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_reason text,
  assigned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_account_assignments_account_active_idx
  ON public.tool_account_assignments(account_id) WHERE status = 'active';
CREATE INDEX tool_account_assignments_user_idx
  ON public.tool_account_assignments(user_id, tool_slug);
-- Prevent double-active per (user, tool)
CREATE UNIQUE INDEX tool_account_assignments_one_active_per_user_tool
  ON public.tool_account_assignments(user_id, tool_slug)
  WHERE status = 'active';
-- Optional: one active per (order) — an order occupies at most one slot
CREATE UNIQUE INDEX tool_account_assignments_one_active_per_order
  ON public.tool_account_assignments(order_id)
  WHERE status = 'active' AND order_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_account_assignments TO authenticated;
GRANT ALL ON public.tool_account_assignments TO service_role;
ALTER TABLE public.tool_account_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignments admin all" ON public.tool_account_assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "assignments owner read" ON public.tool_account_assignments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER tool_account_assignments_touch BEFORE UPDATE ON public.tool_account_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================================
-- 3. tool_account_audit
-- =========================================================================
CREATE TABLE public.tool_account_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  from_account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_account_audit_account_idx ON public.tool_account_audit(account_id, created_at DESC);

GRANT SELECT, INSERT ON public.tool_account_audit TO authenticated;
GRANT ALL ON public.tool_account_audit TO service_role;
ALTER TABLE public.tool_account_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit admin all" ON public.tool_account_audit
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));

-- =========================================================================
-- 4. tool_settings.full_pool_policy
-- =========================================================================
ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS full_pool_policy text NOT NULL DEFAULT 'awaiting_assignment'
    CHECK (full_pool_policy IN ('awaiting_assignment','block_new'));

-- =========================================================================
-- 5. Assignment engine (SECURITY DEFINER; concurrency-safe via row lock)
-- =========================================================================
-- Returns the assignment id (new or existing) if placed; NULL if no capacity.
CREATE OR REPLACE FUNCTION public.assign_tool_account_for_order(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  chosen_account uuid;
  existing_assignment uuid;
  active_count integer;
  new_assignment uuid;
BEGIN
  SELECT id, user_id, tool_slug, access_type, status, expires_at
    INTO o
    FROM public.tool_orders
    WHERE id = _order_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.status <> 'approved' THEN RETURN NULL; END IF;
  IF o.access_type IS NULL THEN RETURN NULL; END IF;

  -- Already assigned?
  SELECT id INTO existing_assignment
    FROM public.tool_account_assignments
    WHERE order_id = _order_id AND status = 'active'
    LIMIT 1;
  IF existing_assignment IS NOT NULL THEN
    RETURN existing_assignment;
  END IF;

  -- Also skip if user already has an active assignment for this tool
  SELECT id INTO existing_assignment
    FROM public.tool_account_assignments
    WHERE user_id = o.user_id AND tool_slug = o.tool_slug AND status = 'active'
    LIMIT 1;
  IF existing_assignment IS NOT NULL THEN
    RETURN existing_assignment;
  END IF;

  -- Pick account with the most available spaces; lock it to prevent overfill.
  SELECT a.id INTO chosen_account
    FROM public.tool_accounts a
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS c
      FROM public.tool_account_assignments x
      WHERE x.account_id = a.id AND x.status = 'active'
    ) usage ON true
    WHERE a.tool_slug = o.tool_slug
      AND a.access_type = o.access_type
      AND a.enabled = true
      AND a.status = 'working'
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND usage.c < a.max_capacity
    ORDER BY (a.max_capacity - usage.c) DESC, a.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF chosen_account IS NULL THEN RETURN NULL; END IF;

  -- Re-check capacity under the lock (defense in depth vs. concurrent inserts).
  SELECT count(*)::int INTO active_count
    FROM public.tool_account_assignments
    WHERE account_id = chosen_account AND status = 'active';
  IF active_count >= (SELECT max_capacity FROM public.tool_accounts WHERE id = chosen_account) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.tool_account_assignments
    (account_id, user_id, order_id, tool_slug, access_type, status, assigned_at)
  VALUES
    (chosen_account, o.user_id, o.id, o.tool_slug, o.access_type, 'active', now())
  RETURNING id INTO new_assignment;

  INSERT INTO public.tool_account_audit (account_id, user_id, order_id, action, actor, notes)
  VALUES (chosen_account, o.user_id, o.id, 'auto_assign', NULL, 'Auto-assigned on order approval');

  RETURN new_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_tool_account_for_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_tool_account_for_order(uuid) TO authenticated, service_role;

-- Release helper
CREATE OR REPLACE FUNCTION public.release_assignments_for_order(_order_id uuid, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE released integer;
BEGIN
  UPDATE public.tool_account_assignments
    SET status = 'released',
        released_at = now(),
        released_reason = _reason
    WHERE order_id = _order_id AND status = 'active';
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;
REVOKE ALL ON FUNCTION public.release_assignments_for_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_assignments_for_order(uuid, text) TO authenticated, service_role;

-- Auto-release trigger on tool_orders status/payment_status changes
CREATE OR REPLACE FUNCTION public.tg_release_on_order_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE reason text;
BEGIN
  IF (NEW.status IN ('expired','cancelled','rejected') AND OLD.status <> NEW.status)
     OR (NEW.payment_status = 'refunded' AND OLD.payment_status <> 'refunded')
     OR (NEW.payment_status = 'reversed' AND OLD.payment_status <> 'reversed')
  THEN
    reason := COALESCE('order_' || NEW.status, 'payment_' || NEW.payment_status);
    PERFORM public.release_assignments_for_order(NEW.id, reason);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_on_order_end ON public.tool_orders;
CREATE TRIGGER trg_release_on_order_end
  AFTER UPDATE ON public.tool_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_release_on_order_end();

-- =========================================================================
-- 6. Backfill: migrate tool_credentials → tool_accounts + active assignments
-- =========================================================================
DO $$
DECLARE
  c RECORD;
  new_account_id uuid;
  active_shared_count integer;
  o RECORD;
BEGIN
  FOR c IN SELECT * FROM public.tool_credentials LOOP
    SELECT count(*)::int INTO active_shared_count
      FROM public.tool_orders
      WHERE tool_slug = c.tool_slug
        AND status = 'approved'
        AND COALESCE(access_type,'shared') = 'shared'
        AND (expires_at IS NULL OR expires_at > now());

    INSERT INTO public.tool_accounts (
      tool_slug, access_type, label,
      login_email, login_password, login_url, login_notes,
      max_capacity, status, enabled, needs_capacity_review
    ) VALUES (
      c.tool_slug, 'shared', 'Migrated account',
      c.login_email, c.login_password, c.login_url, c.login_notes,
      GREATEST(1, active_shared_count),
      'working', true, true
    ) RETURNING id INTO new_account_id;

    FOR o IN
      SELECT id, user_id FROM public.tool_orders
      WHERE tool_slug = c.tool_slug
        AND status = 'approved'
        AND COALESCE(access_type,'shared') = 'shared'
        AND (expires_at IS NULL OR expires_at > now())
    LOOP
      INSERT INTO public.tool_account_assignments
        (account_id, user_id, order_id, tool_slug, access_type, status, assigned_at)
      VALUES
        (new_account_id, o.user_id, o.id, c.tool_slug, 'shared', 'active', now())
      ON CONFLICT DO NOTHING;
    END LOOP;

    INSERT INTO public.tool_account_audit (account_id, action, notes)
    VALUES (new_account_id, 'migrated_from_tool_credentials',
            'Auto-migrated. Review capacity before adding new subscribers.');
  END LOOP;
END $$;


-- =============================================================
-- migration: 20260721125517_babe8693-b108-488c-92ea-3ade992e6391.sql
-- =============================================================


-- Access Health alert settings (stored on the singleton site_settings row).
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS alert_almost_full_pct integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS alert_expiry_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS alert_emails_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_email_recipients text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Log of admin alert emails already sent, keyed by a stable per-issue key
-- so we do not re-notify while an issue is still open.
CREATE TABLE IF NOT EXISTS public.admin_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL UNIQUE,
  alert_type text NOT NULL,
  subject text NOT NULL,
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_alert_log TO authenticated;
GRANT ALL ON public.admin_alert_log TO service_role;

ALTER TABLE public.admin_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read admin alert log"
  ON public.admin_alert_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert admin alert log"
  ON public.admin_alert_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update admin alert log"
  ON public.admin_alert_log FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS admin_alert_log_resolved_idx
  ON public.admin_alert_log (resolved_at, alert_key);


-- =============================================================
-- migration: 20260721131523_1070b7a7-dac6-476a-80eb-2d2a2f79d514.sql
-- =============================================================


-- Seed the admin_alert email template used by Access Health notifications.
INSERT INTO public.email_templates (key, name, subject, html_body, enabled, is_system) VALUES
('admin_alert', 'Access Health alert', 'Access Alert: {{title}}',
'<p>Hi Admin,</p>
<p>An <strong>{{level}}</strong> alert was raised on <strong>{{tool_slug}}</strong>{{account_line}}.</p>
<h3 style="margin:16px 0 8px;font-size:15px;">{{title}}</h3>
<p>{{body}}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:8px;">
  <tr><td style="color:#64748b;">Tool</td><td>{{tool_slug}}</td></tr>
  <tr><td style="color:#64748b;">Account</td><td>{{account_label}}</td></tr>
  <tr><td style="color:#64748b;">Severity</td><td>{{level}}</td></tr>
  <tr><td style="color:#64748b;">Affected customers</td><td>{{affected_customers}}</td></tr>
  <tr><td style="color:#64748b;">Raised at</td><td>{{raised_at}}</td></tr>
</table>
<p style="margin-top:16px;"><a href="{{admin_link}}" style="background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;display:inline-block;">Open Access Health</a></p>
<p style="color:#64748b;font-size:12px;margin-top:16px;">This notification contains no customer credentials, logins, passwords, or payment information.</p>',
true, true)
ON CONFLICT (key) DO NOTHING;

-- Ensure admin_alert appears in the enabled_types map (default + existing row).
ALTER TABLE public.email_settings
  ALTER COLUMN enabled_types SET DEFAULT '{
    "payment_success": true,
    "payment_failed": true,
    "abandoned_checkout": true,
    "offline_confirmed": true,
    "private_pending": true,
    "private_fulfilled": true,
    "renewal_success": true,
    "renewal_failed": true,
    "renewal_disabled": true,
    "customer_invite": true,
    "admin_alert": true
  }'::jsonb;

UPDATE public.email_settings
  SET enabled_types = enabled_types || jsonb_build_object('admin_alert', true)
  WHERE (enabled_types ? 'admin_alert') IS NOT TRUE;


-- =============================================================
-- migration: 20260721171004_2dae8347-3c08-4008-8fff-53271809dab5.sql
-- =============================================================

-- Phase 1 — Admin Control Foundation
-- Adds role_key on admin_accounts, permission overrides, invitations metadata,
-- activity log, and a single-source-of-truth effective-permission resolver.

-- 1) admin_accounts.role_key
ALTER TABLE public.admin_accounts
  ADD COLUMN IF NOT EXISTS role_key text
    CHECK (role_key IS NULL OR role_key IN ('operations','finance','support','content','marketing'));

-- 2) admin_permissions (individual overrides)
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (user_id, permission)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

-- 3) admin_invitations (metadata paired with Supabase Auth invite)
CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role_key text,
  invited_by uuid,
  auth_user_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON public.admin_invitations(lower(email));
CREATE INDEX IF NOT EXISTS admin_invitations_status_idx ON public.admin_invitations(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_invitations TO authenticated;
GRANT ALL ON public.admin_invitations TO service_role;
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;

-- 4) admin_activity_log (append-only)
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  area text,
  target_type text,
  target_id text,
  success boolean NOT NULL DEFAULT true,
  reason text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_activity_log_created_idx ON public.admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_actor_idx ON public.admin_activity_log(actor_user_id);
GRANT SELECT ON public.admin_activity_log TO authenticated;
GRANT ALL ON public.admin_activity_log TO service_role;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

-- 5) admin_effective_permission — single source of truth
CREATE OR REPLACE FUNCTION public.admin_effective_permission(_uid uuid, _perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_active_admin boolean;
  is_super boolean;
  role_key_v text;
  has_override boolean;
  override_granted boolean;
  role_default boolean := false;
BEGIN
  SELECT (ur.is_active IS TRUE) INTO is_active_admin
    FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'admin'
    LIMIT 1;
  IF is_active_admin IS NOT TRUE THEN RETURN false; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = _uid) THEN
    RETURN false;
  END IF;

  SELECT ur.is_super_admin INTO is_super
    FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'admin' LIMIT 1;
  IF is_super IS TRUE THEN RETURN true; END IF;

  SELECT ap.granted INTO override_granted
    FROM public.admin_permissions ap
    WHERE ap.user_id = _uid AND ap.permission = _perm
    LIMIT 1;
  has_override := FOUND;
  IF has_override THEN RETURN override_granted; END IF;

  SELECT aa.role_key INTO role_key_v FROM public.admin_accounts aa WHERE aa.user_id = _uid;

  role_default := CASE
    WHEN role_key_v = 'operations' AND _perm IN (
      'customers.view','customers.edit','orders.manage','subscriptions.manage','credentials.view'
    ) THEN true
    WHEN role_key_v = 'finance' AND _perm IN (
      'customers.view','orders.manage','payments.manage','refunds.process','subscriptions.manage'
    ) THEN true
    WHEN role_key_v = 'support' AND _perm IN (
      'customers.view','support.manage','orders.manage'
    ) THEN true
    WHEN role_key_v = 'content' AND _perm IN (
      'content.manage','promotions.manage'
    ) THEN true
    WHEN role_key_v = 'marketing' AND _perm IN (
      'marketing.manage','emails.manage','promotions.manage'
    ) THEN true
    ELSE false
  END;

  RETURN role_default;
END; $$;

REVOKE ALL ON FUNCTION public.admin_effective_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_effective_permission(uuid, text) TO authenticated, service_role;

-- 6) Extend protect_last_super_admin to also block DELETE
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE remaining int;
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.is_super_admin = true
     AND OLD.role = 'admin'
     AND OLD.is_active = true THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot delete the last super admin';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
      AND OLD.is_super_admin = true
      AND OLD.role = 'admin'
      AND OLD.is_active = true
      AND (NEW.is_super_admin = false OR NEW.is_active = false OR NEW.role <> 'admin') THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last super admin';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS user_roles_protect_last_super_admin ON public.user_roles;
CREATE TRIGGER user_roles_protect_last_super_admin
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- 7) RLS policies

-- admin_permissions: super-admins only
DROP POLICY IF EXISTS "super admins read admin_permissions" ON public.admin_permissions;
CREATE POLICY "super admins read admin_permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admins write admin_permissions" ON public.admin_permissions;
CREATE POLICY "super admins write admin_permissions" ON public.admin_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- admin_invitations: super-admins only
DROP POLICY IF EXISTS "super admins read admin_invitations" ON public.admin_invitations;
CREATE POLICY "super admins read admin_invitations" ON public.admin_invitations
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admins write admin_invitations" ON public.admin_invitations;
CREATE POLICY "super admins write admin_invitations" ON public.admin_invitations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- admin_activity_log: SELECT for super admins OR audit.view permission
DROP POLICY IF EXISTS "activity log read" ON public.admin_activity_log;
CREATE POLICY "activity log read" ON public.admin_activity_log
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.admin_effective_permission(auth.uid(), 'audit.view')
  );
-- No INSERT/UPDATE/DELETE policies — writes are service_role only.

-- 8) Backfill role_key for existing non-super admins to a safe default
UPDATE public.admin_accounts aa
  SET role_key = 'operations'
  WHERE role_key IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = aa.user_id AND ur.role='admin' AND ur.is_super_admin=true
    );


-- =============================================================
-- migration: 20260725042738_a79a6702-9300-49c9-b732-c3f41ae49fe1.sql
-- =============================================================

-- === tool_overrides: admin-editable metadata for existing hardcoded tools ===
CREATE TABLE public.tool_overrides (
  tool_slug TEXT PRIMARY KEY,
  name TEXT,
  tagline TEXT,
  description TEXT,
  category TEXT,
  domain TEXT,
  image_url TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_overrides TO anon, authenticated;
GRANT ALL ON public.tool_overrides TO service_role;

ALTER TABLE public.tool_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tool overrides"
  ON public.tool_overrides FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert tool overrides"
  ON public.tool_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tool overrides"
  ON public.tool_overrides FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete tool overrides"
  ON public.tool_overrides FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_tool_overrides_touch_updated_at
  BEFORE UPDATE ON public.tool_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- === promotions: simple offers manageable from the admin dashboard ===
CREATE TABLE public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  tool_slug TEXT,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('new','existing','all')),
  discount_type TEXT CHECK (discount_type IN ('percent','amount','free_days','bundle')),
  discount_value NUMERIC,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT ALL ON public.promotions TO service_role;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active promotions"
  ON public.promotions FOR SELECT
  USING (
    is_active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

CREATE POLICY "Admins can read all promotions"
  ON public.promotions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert promotions"
  ON public.promotions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update promotions"
  ON public.promotions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete promotions"
  ON public.promotions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX promotions_active_idx ON public.promotions (is_active, ends_at);
CREATE INDEX promotions_tool_slug_idx ON public.promotions (tool_slug);

CREATE TRIGGER tg_promotions_touch_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- =============================================================
-- migration: 20260725042819_997236dd-6849-4157-a3ce-65b4e0b47626.sql
-- =============================================================

CREATE POLICY "Public read tool images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tool-images');

CREATE POLICY "Admins can upload tool images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'tool-images' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tool images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'tool-images' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'tool-images' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete tool images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'tool-images' AND public.has_role(auth.uid(), 'admin'));


-- =============================================================
-- migration: 20260725045338_185f9459-f023-424f-9ee7-12c8dd450a02.sql
-- =============================================================

CREATE TABLE public.payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  public_key text,
  webhook_secret_hint text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_status text,
  last_test_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_providers admin select" ON public.payment_providers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "payment_providers admin write" ON public.payment_providers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_payment_providers
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Ensure only one active provider at a time
CREATE UNIQUE INDEX payment_providers_only_one_active
ON public.payment_providers ((true))
WHERE is_active = true;

-- Seed Paystack as the default provider
INSERT INTO public.payment_providers (slug, display_name, environment, enabled, is_active, config)
VALUES (
  'paystack',
  'Paystack',
  'live',
  true,
  true,
  jsonb_build_object('supports_recurring', true, 'currency', 'NGN')
)
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- migration: 20260725051416_a739b66e-dbc5-4fdc-bd60-4b3ed342a281.sql
-- =============================================================


INSERT INTO public.email_templates (key, name, subject, html_body, text_body, enabled)
VALUES (
  'admin_manual',
  'Admin manual message',
  '{{subject}}',
  '<p>Hi {{name}},</p>{{{body_html}}}<p style="margin-top:24px;">— {{sender_name}}</p>',
  NULL,
  true
)
ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- migration: 20260725055458_5d0c5f95-515c-4ff3-9e3c-d56782f7d17c.sql
-- =============================================================

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orders_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payments_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emails_paused boolean NOT NULL DEFAULT false;


-- =============================================================
-- migration: 20260729031705_de34047a-50f9-4458-b580-247d61701a43.sql
-- =============================================================

UPDATE public.email_templates
SET
  subject = 'Payment received — {{tool}} access is active',
  html_body = '<p>Hi {{name}},</p>' ||
    '<p>Thanks for your payment to <strong>Top Rated SEO Tools</strong>. Your access is now active.</p>' ||
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">' ||
    '<tr><td><strong>Tool</strong></td><td>{{tool}}</td></tr>' ||
    '<tr><td><strong>Plan</strong></td><td>{{access_type}} — {{billing_period}}</td></tr>' ||
    '<tr><td><strong>Amount paid</strong></td><td>{{currency}} {{amount}}</td></tr>' ||
    '<tr><td><strong>Payment date</strong></td><td>{{start_date}}</td></tr>' ||
    '<tr><td><strong>Paystack reference</strong></td><td>{{reference}}</td></tr>' ||
    '<tr><td><strong>Access expires</strong></td><td>{{expiry_date}}</td></tr>' ||
    '</table>' ||
    '<p style="margin-top:16px"><a href="{{dashboard_url}}">Open your dashboard</a></p>' ||
    '<p>— Top Rated SEO Tools</p>'
WHERE key = 'payment_success';


-- =============================================================
-- migration: 20260729082702_a4ffc96e-fc76-4ceb-b7be-34abbb6ba74b.sql
-- =============================================================


-- 1. currency_settings singleton
CREATE TABLE public.currency_settings (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  switching_enabled boolean NOT NULL DEFAULT true,
  surcharge_enabled boolean NOT NULL DEFAULT true,
  surcharge_percent numeric(6,3) NOT NULL DEFAULT 3.000,
  supported_currencies text[] NOT NULL DEFAULT ARRAY['NGN','GHS','KES','ZAR','USD'],
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.currency_settings TO anon, authenticated;
GRANT ALL ON public.currency_settings TO service_role;
ALTER TABLE public.currency_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "currency_settings readable by all" ON public.currency_settings FOR SELECT USING (true);
CREATE POLICY "currency_settings admin update" ON public.currency_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "currency_settings admin insert" ON public.currency_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.currency_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

-- 2. exchange_rates
CREATE TABLE public.exchange_rates (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'NGN',
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL DEFAULT 'exchangerate.host',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency)
);
GRANT SELECT ON public.exchange_rates TO anon, authenticated;
GRANT ALL ON public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rates readable by all" ON public.exchange_rates FOR SELECT USING (true);
CREATE POLICY "exchange_rates admin write" ON public.exchange_rates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3. exchange_rate_logs (append-only)
CREATE TABLE public.exchange_rate_logs (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'NGN',
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exchange_rate_logs TO authenticated;
GRANT ALL ON public.exchange_rate_logs TO service_role;
ALTER TABLE public.exchange_rate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rate_logs admin read" ON public.exchange_rate_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. tool_payments currency fields
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS base_amount_ngn numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,10),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS international_fee_percent numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS international_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount numeric(14,2);

-- 5. tool_orders currency fields
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot numeric(20,10),
  ADD COLUMN IF NOT EXISTS international_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount_charged numeric(14,2);

-- 6. subscription currency
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS renewal_currency text NOT NULL DEFAULT 'NGN';

ALTER TABLE public.paystack_plan_mappings
  ADD COLUMN IF NOT EXISTS subscription_currency text NOT NULL DEFAULT 'NGN';

CREATE TRIGGER currency_settings_touch BEFORE UPDATE ON public.currency_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER exchange_rates_touch BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- =============================================================
-- migration: 20260801000625_b1dcea76-0905-474a-bb3a-817fcc1167d5.sql
-- =============================================================

UPDATE public.email_templates
SET html_body = '<p>Hi {{name}},</p><p>Thanks for your payment to <strong>Top Rated SEO Tools</strong>. Your access is now active.</p><table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px"><tr><td><strong>Tool</strong></td><td>{{tool}}</td></tr><tr><td><strong>Plan</strong></td><td>{{access_type}} — {{billing_period}}</td></tr><tr><td><strong>Amount paid</strong></td><td>{{currency}} {{amount}}</td></tr><tr><td><strong>Payment date</strong></td><td>{{start_date}}</td></tr><tr><td><strong>Paystack reference</strong></td><td>{{reference}}</td></tr><tr><td><strong>Access expires</strong></td><td>{{expiry_date}}</td></tr></table><p style="margin-top:8px;font-size:13px;color:#475569">{{currency_note}}</p><p style="margin-top:16px"><a href="{{dashboard_url}}">Open your dashboard</a></p><p>— Top Rated SEO Tools</p>',
    updated_at = now()
WHERE key = 'payment_success';


-- =============================================================
-- migration: 20260801001944_96d43da3-8a73-4dd7-8467-93ff94bcee7f.sql
-- =============================================================

UPDATE public.email_templates
SET html_body = replace(html_body, '<p style="margin-top:8px;font-size:13px;color:#475569">{{currency_note}}</p>', '')
WHERE key = 'payment_success';


-- =============================================================
-- migration: 20260801015908_1029344c-8fa9-42e9-a7db-2b30d7512ebb.sql
-- =============================================================

-- Coupons: NGN is the source of truth for all discounts.
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  tool_slug text,
  access_type text CHECK (access_type IN ('shared','private')),
  billing_period text CHECK (billing_period IN ('monthly','quarterly','yearly')),
  min_amount_ngn numeric(12,2),
  max_redemptions integer,
  max_per_user integer NOT NULL DEFAULT 1,
  redemptions_count integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_key ON public.coupons (upper(code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage coupons" ON public.coupons;
CREATE POLICY "Admins manage coupons" ON public.coupons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS coupons_touch ON public.coupons;
CREATE TRIGGER coupons_touch BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  coupon_code text NOT NULL,
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0,
  base_amount_ngn numeric(12,2),
  payment_currency text,
  final_amount numeric(12,2),
  paystack_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_order_key ON public.coupon_redemptions (order_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON public.coupon_redemptions (coupon_id, user_id);

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own redemptions" ON public.coupon_redemptions;
CREATE POLICY "Users view own redemptions" ON public.coupon_redemptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Order + payment records carry the coupon snapshot so display, charge,
-- verification and reporting all read the same numbers.
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_amount_ngn numeric(12,2);

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0;

-- Atomic redemption recorder: increments usage once per order.
CREATE OR REPLACE FUNCTION public.record_coupon_redemption(
  _order_id uuid,
  _paystack_reference text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o RECORD;
BEGIN
  SELECT id, user_id, coupon_id, coupon_code, discount_amount_ngn,
         discounted_amount_ngn, price_amount, payment_currency, final_amount_charged
    INTO o
    FROM public.tool_orders
    WHERE id = _order_id
    FOR UPDATE;
  IF NOT FOUND OR o.coupon_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE order_id = _order_id) THEN
    RETURN false;
  END IF;

  INSERT INTO public.coupon_redemptions
    (coupon_id, coupon_code, user_id, order_id, discount_amount_ngn,
     base_amount_ngn, payment_currency, final_amount, paystack_reference)
  VALUES
    (o.coupon_id, o.coupon_code, o.user_id, o.id, COALESCE(o.discount_amount_ngn, 0),
     COALESCE(o.discounted_amount_ngn, o.price_amount), o.payment_currency,
     o.final_amount_charged, _paystack_reference);

  UPDATE public.coupons
    SET redemptions_count = redemptions_count + 1
    WHERE id = o.coupon_id;

  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.record_coupon_redemption(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_coupon_redemption(uuid, text) TO service_role;


-- =============================================================
-- migration: 20260801021514_a022af9e-185e-4f1f-9dea-1256849392b9.sql
-- =============================================================

UPDATE public.email_templates
SET html_body = replace(
  html_body,
  '<p style="margin-top:8px;font-size:13px;color:#475569">{{currency_note}}</p>',
  '<p style="margin-top:8px;font-size:13px;color:#475569">{{coupon_note}}</p><p style="margin-top:4px;font-size:13px;color:#475569">{{currency_note}}</p>'
)
WHERE key = 'payment_success'
  AND html_body LIKE '%{{currency_note}}%'
  AND html_body NOT LIKE '%{{coupon_note}}%';


-- =============================================================
-- migration: 20260801024553_961fcf34-7dad-4461-8b7a-e47394ccab2e.sql
-- =============================================================

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS display_currency text,
  ADD COLUMN IF NOT EXISTS display_amount numeric;

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS display_currency text,
  ADD COLUMN IF NOT EXISTS display_amount numeric;

ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS merchant_currencies text[] NOT NULL DEFAULT ARRAY['NGN']::text[];

COMMENT ON COLUMN public.tool_orders.display_currency IS 'Currency shown to the customer (may differ from the Paystack charge currency).';
COMMENT ON COLUMN public.tool_orders.display_amount IS 'Amount shown to the customer in display_currency.';
COMMENT ON COLUMN public.currency_settings.merchant_currencies IS 'Currencies the Paystack merchant account can actually charge.';


-- =============================================================
-- migration: 20260801033502_03036f37-cdcd-4fc6-809c-30a644fa4fdf.sql
-- =============================================================

UPDATE public.email_settings
SET resend_domain_id = '4b69aba7-b488-488f-8f5f-0c2f72001614',
    resend_domain_status = 'verified',
    last_verified_at = now()
WHERE id = true;

SELECT cron.unschedule('auto-fulfil-private-orders');

SELECT cron.schedule(
  'auto-fulfil-private-orders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/auto-fulfil-private',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT value FROM public.internal_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);


-- =============================================================
-- migration: 20260801033528_20c54294-06c4-4693-a32d-8c38d52c9f74.sql
-- =============================================================

INSERT INTO public.email_messages (event_key, template_key, recipient, payload, status, scheduled_for)
VALUES
 ('prodtest_invite:2026-08-01', 'customer_invite', 'Smartmove1914@gmail.com',
  '{"name":"Smartmove","setup_url":"https://topratedseotools.com/login","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now()),
 ('prodtest_payment:2026-08-01', 'payment_success', 'Smartmove1914@gmail.com',
  '{"name":"Smartmove","tool":"Semrush","plan":"Shared access · Monthly","amount":"NGN 10,400","reference":"PRODTEST-2026-08-01","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now()),
 ('prodtest_admin:2026-08-01', 'admin_alert', 'Nnaemekasolomon31@gmail.com',
  '{"level":"info","tool_slug":"system","account_line":"","title":"Production email delivery test","body":"This is a live delivery test of the admin alert channel.","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now());


-- =============================================================
-- migration: 20260801090821_8cf1fbf0-80df-4dc0-a91c-f3f347ec203c.sql
-- =============================================================

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS gateway_transaction_reference text,
  ADD COLUMN IF NOT EXISTS gateway_response jsonb;

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS gateway_transaction_reference text,
  ADD COLUMN IF NOT EXISTS gateway_response jsonb;

ALTER TABLE public.paystack_webhook_events
  ADD COLUMN IF NOT EXISTS gateway text NOT NULL DEFAULT 'paystack';

CREATE INDEX IF NOT EXISTS tool_payments_gateway_ref_idx
  ON public.tool_payments (payment_gateway, gateway_transaction_reference);
CREATE INDEX IF NOT EXISTS tool_orders_gateway_idx
  ON public.tool_orders (payment_gateway);

INSERT INTO public.payment_providers (slug, display_name, environment, enabled, is_active, config)
VALUES
  ('flutterwave', 'Flutterwave', 'live', false, false, '{"currency":"NGN","supports_recurring":false}'::jsonb),
  ('monnify', 'Monnify', 'live', false, false, '{"currency":"NGN","supports_recurring":false,"contract_code":null,"base_url":"https://api.monnify.com"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- migration: 20260801091514_0ae21e9d-bb60-4198-b90a-26828ea7a33f.sql
-- =============================================================

ALTER TABLE public.tool_payments DROP CONSTRAINT IF EXISTS tool_payments_source_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_source_check
  CHECK (source = ANY (ARRAY['paystack'::text, 'flutterwave'::text, 'monnify'::text, 'offline'::text]));


-- =============================================================
-- migration: 20260801112536_73319d19-f45e-413f-8f7c-9bfee9e5532c.sql
-- =============================================================

UPDATE public.payment_providers
SET last_test_status = NULL,
    last_test_message = NULL,
    last_test_at = NULL
WHERE slug = 'flutterwave'
  AND last_test_message ILIKE '%subaccount%';


-- =============================================================
-- migration: 20260802031011_5ac6f300-fc74-44e0-9075-b1edcd02cda7.sql
-- =============================================================

ALTER TABLE public.tool_overrides
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access text,
  ADD COLUMN IF NOT EXISTS features jsonb,
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;


-- =============================================================
-- migration: 20260802040415_b82b659d-5fbe-4c12-bc9b-1d0b4445f7df.sql
-- =============================================================

ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS brand_name text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS brand_color text NOT NULL DEFAULT '#5b62f9',
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  ADD COLUMN IF NOT EXISTS footer_company text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS footer_support_email text NOT NULL DEFAULT 'support@topratedseotools.com',
  ADD COLUMN IF NOT EXISTS footer_website_url text NOT NULL DEFAULT 'https://topratedseotools.com',
  ADD COLUMN IF NOT EXISTS footer_message text NOT NULL DEFAULT 'Premium SEO, AI and productivity tools.';


-- =============================================================
-- migration: 20260802042524_5ecf1fe6-923e-4b28-8afc-40cd58b0879a.sql
-- =============================================================

ALTER TABLE public.email_settings ALTER COLUMN brand_color SET DEFAULT '#1e4e8c';

UPDATE public.email_settings
SET brand_color = '#1e4e8c'
WHERE brand_color IN ('#5b62f9', '#5B62F9');

UPDATE public.email_settings
SET brand_logo_url = 'https://topratedseotools.com/__l5e/assets-v1/f3e454df-dc80-4286-a457-12dd873e04bf/top-rated-seo-tools-icon.png'
WHERE brand_logo_url IS NULL OR btrim(brand_logo_url) = '';


-- =============================================================
-- migration: 20260802100259_cbdb9e79-7cfe-4109-bf31-a585339594ea.sql
-- =============================================================

ALTER TABLE public.email_settings ALTER COLUMN brand_logo_url SET DEFAULT 'https://topratedseotools.com/__l5e/assets-v1/147b0b3f-0398-4309-87ad-9624e5934639/top-rated-seo-tools-logo.png';
UPDATE public.email_settings
SET brand_logo_url = 'https://topratedseotools.com/__l5e/assets-v1/147b0b3f-0398-4309-87ad-9624e5934639/top-rated-seo-tools-logo.png'
WHERE brand_logo_url IS NULL OR brand_logo_url = '' OR brand_logo_url LIKE '%top-rated-seo-tools-icon.png';


-- =============================================================
-- migration: 20260817165758_81200ff8-b46e-49ae-9ec6-37abcb92d00f.sql
-- =============================================================

UPDATE public.payment_providers SET is_active = false WHERE slug <> 'paystack';
UPDATE public.payment_providers SET is_active = true, enabled = true WHERE slug = 'paystack';


-- =============================================================
-- migration: 20260817181500_atomic_active_payment_provider.sql
-- =============================================================

-- Atomically switch the single active checkout gateway.
-- The application performs Super Admin authentication and live credential
-- validation before invoking this RPC through the service-role client.

create or replace function public.set_active_payment_provider(_provider_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  select slug into v_slug
  from public.payment_providers
  where id = _provider_id
  for update;

  if not found then
    raise exception 'Provider not found';
  end if;

  update public.payment_providers
  set is_active = (id = _provider_id),
      enabled = case when id = _provider_id then true else enabled end;

  return v_slug;
end;
$$;

revoke all on function public.set_active_payment_provider(uuid) from public, anon, authenticated;
grant execute on function public.set_active_payment_provider(uuid) to service_role;


-- =============================================================
-- migration: 20260817183000_suno_contact_admin_only.sql
-- =============================================================

-- Suno is not directly purchasable until Admin explicitly replaces this policy.
-- Keep the existing Contact Admin row and disable the direct monthly price.
update public.tool_pricing
set enabled = false
where id = '866fb216-26a0-4e5b-9eea-0881662e67ba'
  and tool_slug = 'suno';


-- =============================================================
-- migration: 20260817190000_browser_auth_providers.sql
-- =============================================================

-- Browser-based one-click authentication configuration and audit trail.
-- API tokens remain in internal_secrets; these tables contain no secret values.

create table if not exists public.browser_auth_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  default_provider text not null default 'browser_use'
    check (default_provider in ('browser_use', 'cloudflare')),
  session_timeout_minutes integer not null default 30
    check (session_timeout_minutes between 5 and 60),
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

insert into public.browser_auth_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.browser_auth_settings enable row level security;
revoke all on table public.browser_auth_settings from anon, authenticated;

create table if not exists public.browser_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid null references public.tool_orders(id) on delete set null,
  tool_slug text not null,
  provider text not null check (provider in ('browser_use', 'cloudflare')),
  provider_session_id text null,
  status text not null default 'starting'
    check (status in ('starting', 'ready', 'failed', 'expired', 'closed')),
  error_code text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists browser_auth_sessions_user_recent_idx
  on public.browser_auth_sessions (user_id, created_at desc);
create index if not exists browser_auth_sessions_order_idx
  on public.browser_auth_sessions (order_id, created_at desc);

alter table public.browser_auth_sessions enable row level security;
revoke all on table public.browser_auth_sessions from anon, authenticated;

-- Constrain per-tool provider overrides to the supported browser engines.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tool_settings_auth_provider_supported'
      and conrelid = 'public.tool_settings'::regclass
  ) then
    alter table public.tool_settings
      add constraint tool_settings_auth_provider_supported
      check (auth_provider is null or auth_provider in ('browser_use', 'cloudflare'));
  end if;
end $$;


-- =============================================================
-- migration: 20260817194000_paid_access_invariant.sql
-- =============================================================

-- Purchased access must never become active before payment has been verified.
-- Gateway/offline verification updates status and payment_status together, so
-- legitimate successful payments continue to activate immediately.

create or replace function public.enforce_paid_order_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'approved'
     and coalesce(new.payment_status::text, 'pending') <> 'successful' then
    raise exception 'Cannot approve an order until payment_status is successful';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_paid_order_approval() from public, anon, authenticated;

drop trigger if exists trg_enforce_paid_order_approval on public.tool_orders;
create trigger trg_enforce_paid_order_approval
before insert or update of status, payment_status on public.tool_orders
for each row execute function public.enforce_paid_order_approval();

create or replace function public.user_has_tool_access(_user_id uuid, _slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tool_orders
    where user_id = _user_id
      and tool_slug = _slug
      and status::text = 'approved'
      and payment_status::text = 'successful'
      and (expires_at is null or expires_at > now())
  );
$$;

-- This is a customer-scoped read helper. Keep it callable only by signed-in
-- users and service-role; anon/public do not need it.
revoke all on function public.user_has_tool_access(uuid, text) from public, anon;
grant execute on function public.user_has_tool_access(uuid, text) to authenticated, service_role;


-- =============================================================
-- migration: 20260817200000_security_definer_and_cron_hardening.sql
-- =============================================================

-- Restrict privileged SECURITY DEFINER helpers to the roles that actually need them.
revoke all on function public.assign_tool_account_for_order(uuid) from public, anon, authenticated;
grant execute on function public.assign_tool_account_for_order(uuid) to service_role;

revoke all on function public.record_coupon_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.record_coupon_redemption(uuid, text) to service_role;

revoke all on function public.release_assignments_for_order(uuid, text) from public, anon, authenticated;
grant execute on function public.release_assignments_for_order(uuid, text) to service_role;

revoke all on function public.tg_release_on_order_end() from public, anon, authenticated;
grant execute on function public.tg_release_on_order_end() to service_role;

revoke execute on function public.admin_effective_permission(uuid, text) from anon;

-- The email dispatcher must fetch the shared cron credential from server-only
-- internal_secrets rather than embedding the credential inside cron.job.command.
select cron.alter_job(
  3,
  command := $cmd$
    SELECT net.http_post(
      url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/email-dispatcher',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret', (SELECT value FROM public.internal_secrets WHERE name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);


-- =============================================================
-- migration: 20260817203000_fix_canva_private_plan.sql
-- =============================================================

-- The ₦6,500/year Canva row is labelled Private account but was incorrectly
-- stored as shared access, creating a duplicate Shared/Yearly option.
update public.tool_pricing
set access_type = 'private'
where id = 'a92a735d-687c-4dea-8bd7-1fa606188a37'
  and tool_slug = 'canva-pro'
  and label = 'Private account';


-- =============================================================
-- migration: 20260817211500_add_sneakwrite.sql
-- =============================================================

-- SneakWrite catalogue seed.
-- SneakWrite is a built-in customer-facing humanizer positioned between
-- Stealthwriter and Phrasly in src/lib/tools-data.ts. This row provides
-- editable customer-facing overrides and production settings/pricing.

insert into public.tool_overrides (
  tool_slug,
  name,
  tagline,
  description,
  category,
  domain,
  image_url,
  is_visible,
  is_custom,
  access,
  features,
  featured,
  updated_at
) values (
  'sneakwrite',
  'SneakWrite',
  'Next-generation AI humanizer for natural, polished writing',
  'SneakWrite is a premium AI humanizer built for writers who want AI-assisted drafts to read with stronger flow, more natural phrasing and a convincingly human voice. It refines essays, articles, reports and everyday content while preserving the core meaning, making it a standout option in the new generation of AI rewriting tools.',
  'AI Detection Bypass',
  'sneakwrite.net',
  null,
  true,
  false,
  'pro',
  '["Humanizes AI-assisted drafts into natural, fluent writing","Preserves the original meaning while improving rhythm and phrasing","Refines tone for essays, articles, reports and professional content","Built for fast, polished rewriting with a clean human voice"]'::jsonb,
  true,
  now()
)
on conflict (tool_slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  category = excluded.category,
  domain = excluded.domain,
  is_visible = excluded.is_visible,
  is_custom = excluded.is_custom,
  access = excluded.access,
  features = excluded.features,
  featured = excluded.featured,
  updated_at = now();

insert into public.tool_settings (
  tool_slug,
  enabled,
  access_level,
  one_click_auth_enabled,
  official_login_url,
  auth_provider,
  launch_mode,
  display_manual_credentials,
  shared_access_enabled,
  private_access_enabled,
  shared_access_authorization,
  private_access_authorization,
  full_pool_policy,
  updated_at
) values (
  'sneakwrite',
  true,
  'purchased',
  false,
  'https://sneakwrite.net',
  null,
  'new_tab',
  true,
  true,
  false,
  'confirmed',
  'confirmed',
  'awaiting_assignment',
  now()
)
on conflict (tool_slug) do update set
  enabled = true,
  access_level = 'purchased',
  official_login_url = 'https://sneakwrite.net',
  shared_access_enabled = true,
  private_access_enabled = false,
  updated_at = now();

-- SneakWrite currently has one standard Shared monthly plan.
delete from public.tool_pricing where tool_slug = 'sneakwrite';
insert into public.tool_pricing (
  tool_slug,
  label,
  amount,
  unit,
  currency,
  contact_admin,
  sort_order,
  duration_days,
  grace_days,
  warning_days,
  access_type,
  enabled,
  note,
  badge,
  paystack_plan_code,
  billing_period,
  created_at,
  updated_at
) values (
  'sneakwrite',
  null,
  8500,
  null,
  '₦',
  false,
  0,
  28,
  0,
  0,
  'shared',
  true,
  null,
  null,
  null,
  'monthly',
  now(),
  now()
);


-- =============================================================
-- migration: 20260817213000_custom_payment_links.sql
-- =============================================================

-- One-time Custom Payments: admin-created public Paystack links that do not
-- create tool subscriptions or grant tool access.

create table if not exists public.custom_payment_links (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  title text not null,
  description text,
  amount_ngn numeric(14,2) not null check (amount_ngn > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  recipient_name text,
  recipient_email text,
  status text not null default 'active' check (status in ('active','paid','disabled')),
  expires_at timestamptz,
  paid_at timestamptz,
  paid_reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.custom_payment_links(id) on delete cascade,
  reference text not null unique,
  amount_ngn numeric(14,2) not null check (amount_ngn > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  payer_name text,
  payer_email text not null,
  payment_gateway text not null default 'paystack',
  paystack_environment text not null default 'live',
  gateway_transaction_id text,
  status text not null default 'initiated' check (status in ('initiated','successful','failed')),
  initiated_at timestamptz not null default now(),
  paid_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_payment_links_status_idx
  on public.custom_payment_links(status, created_at desc);
create index if not exists custom_payment_transactions_link_idx
  on public.custom_payment_transactions(link_id, created_at desc);

alter table public.custom_payment_links enable row level security;
alter table public.custom_payment_transactions enable row level security;

revoke all on public.custom_payment_links from anon, authenticated;
revoke all on public.custom_payment_transactions from anon, authenticated;
grant all on public.custom_payment_links to service_role;
grant all on public.custom_payment_transactions to service_role;

create or replace function public.finalize_custom_payment(
  _link_id uuid,
  _reference text,
  _gateway_transaction_id text,
  _payer_name text,
  _payer_email text,
  _paid_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _link public.custom_payment_links%rowtype;
begin
  select * into _link
  from public.custom_payment_links
  where id = _link_id
  for update;

  if not found then
    raise exception 'Custom payment link not found';
  end if;

  update public.custom_payment_transactions
  set status = 'successful',
      gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
      payer_name = coalesce(_payer_name, payer_name),
      payer_email = coalesce(nullif(_payer_email, ''), payer_email),
      paid_at = coalesce(paid_at, _paid_at),
      last_error = null,
      updated_at = now()
  where link_id = _link_id and reference = _reference;

  if _link.status <> 'paid' then
    update public.custom_payment_links
    set status = 'paid',
        paid_at = _paid_at,
        paid_reference = _reference,
        updated_at = now()
    where id = _link_id;
    return true;
  end if;

  return _link.paid_reference = _reference;
end;
$$;

revoke all on function public.finalize_custom_payment(uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_custom_payment(uuid,text,text,text,text,timestamptz) to service_role;


-- =============================================================
-- migration: 20260817235000_stable_brand_logo.sql
-- =============================================================

-- Brand asset hardening.
-- Keep email HTML off Lovable-internal /__l5e asset paths so external email
-- clients can fetch the same public logo used by the website and favicon.
update public.email_settings
set brand_logo_url = 'https://topratedseotools.com/favicon.png?v=20260817b',
    updated_at = now()
where id = true;


-- =============================================================
-- migration: 20260818000500_custom_payment_multicurrency.sql
-- =============================================================

-- Custom Payments only: make amount currency-neutral while keeping legacy NGN columns nullable for compatibility.

alter table public.custom_payment_links
  add column if not exists amount numeric;

update public.custom_payment_links
set amount = amount_ngn
where amount is null;

alter table public.custom_payment_links
  alter column amount_ngn drop not null;

alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_amount_ngn_check;
alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_currency_check;
alter table public.custom_payment_links
  add constraint custom_payment_links_amount_check check (amount > 0),
  add constraint custom_payment_links_currency_check check (currency ~ '^[A-Z]{3}$');

alter table public.custom_payment_transactions
  add column if not exists amount numeric;

update public.custom_payment_transactions
set amount = amount_ngn
where amount is null;

alter table public.custom_payment_transactions
  alter column amount_ngn drop not null;

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_amount_ngn_check;
alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_currency_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_amount_check check (amount > 0),
  add constraint custom_payment_transactions_currency_check check (currency ~ '^[A-Z]{3}$');

comment on column public.custom_payment_links.amount is 'Major-unit amount in currency; authoritative amount for Custom Payments.';
comment on column public.custom_payment_links.amount_ngn is 'Legacy compatibility only; populated only when currency=NGN.';
comment on column public.custom_payment_transactions.amount is 'Major-unit amount in currency; authoritative amount verified against Paystack.';
comment on column public.custom_payment_transactions.amount_ngn is 'Legacy compatibility only; populated only when currency=NGN.';


-- =============================================================
-- migration: 20260818000600_custom_payment_amount_not_null.sql
-- =============================================================

-- Every Custom Payment must have an authoritative currency-neutral major-unit amount.
alter table public.custom_payment_links alter column amount set not null;
alter table public.custom_payment_transactions alter column amount set not null;


-- =============================================================
-- migration: 20260818143000_admin_lifetime_tool_grants.sql
-- =============================================================

-- Non-payment admin grants for complimentary/lifetime tool access.
-- These are intentionally separate from payment/order records.

create table if not exists public.tool_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null,
  access_type text not null default 'shared' check (access_type in ('shared','private')),
  account_id uuid not null references public.tool_accounts(id) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz null,
  granted_at timestamptz not null default now(),
  granted_by uuid null references auth.users(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tool_access_grants enable row level security;

create unique index if not exists tool_access_grants_one_active_per_user_tool
  on public.tool_access_grants(user_id, tool_slug)
  where status = 'active';

create index if not exists tool_access_grants_account_active_idx
  on public.tool_access_grants(account_id)
  where status = 'active';

alter table public.tool_account_assignments
  add column if not exists grant_id uuid null references public.tool_access_grants(id) on delete cascade;

create unique index if not exists tool_account_assignments_one_active_per_grant
  on public.tool_account_assignments(grant_id)
  where status = 'active' and grant_id is not null;

alter table public.browser_auth_sessions
  add column if not exists grant_id uuid null references public.tool_access_grants(id) on delete set null;


-- =============================================================
-- migration: 20260818174500_drop_unused_direct_sso_tickets.sql
-- =============================================================

-- The final SneakWrite One-Click flow verifies the admin-managed account
-- credentials directly with SneakWrite and no longer uses cross-app tickets.
drop table if exists public.direct_sso_tickets;


-- =============================================================
-- migration: 20260818181000_direct_sso_tickets.sql
-- =============================================================

-- One-time server-to-server SSO tickets for owned tools.
-- These are intentionally separate from payment records and browser sessions.
create table if not exists public.direct_sso_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null,
  account_id uuid null references public.tool_accounts(id) on delete set null,
  target_email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists direct_sso_tickets_user_tool_idx
  on public.direct_sso_tickets (user_id, tool_slug, created_at desc);

create index if not exists direct_sso_tickets_expiry_idx
  on public.direct_sso_tickets (expires_at)
  where consumed_at is null;

alter table public.direct_sso_tickets enable row level security;

comment on table public.direct_sso_tickets is
  'Short-lived, single-use SSO tickets issued server-side for owned tools. No client policies; service role only.';


-- =============================================================
-- migration: 20260819061000_custom_payment_gateway_selection.sql
-- =============================================================

-- Custom Payments: persist the selected gateway on each payment link so a
-- later global gateway change cannot reroute an existing bill.

alter table public.custom_payment_links
  add column if not exists payment_gateway text;

update public.custom_payment_links
set payment_gateway = 'paystack'
where payment_gateway is null;

alter table public.custom_payment_links
  alter column payment_gateway set default 'paystack',
  alter column payment_gateway set not null;

alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_payment_gateway_check;
alter table public.custom_payment_links
  add constraint custom_payment_links_payment_gateway_check
  check (payment_gateway in ('paystack', 'flutterwave'));

alter table public.custom_payment_transactions
  add column if not exists gateway_environment text;

update public.custom_payment_transactions
set gateway_environment = coalesce(paystack_environment, 'live')
where gateway_environment is null;

alter table public.custom_payment_transactions
  alter column gateway_environment set default 'live',
  alter column gateway_environment set not null;

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_payment_gateway_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_payment_gateway_check
  check (payment_gateway in ('paystack', 'flutterwave'));

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_gateway_environment_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_gateway_environment_check
  check (gateway_environment in ('test', 'live'));

create index if not exists custom_payment_links_gateway_idx
  on public.custom_payment_links(payment_gateway, created_at desc);

comment on column public.custom_payment_links.payment_gateway is
  'Gateway selected when the Custom Payment link was created. Immutable for checkout routing.';
comment on column public.custom_payment_transactions.gateway_environment is
  'Gateway credential environment used for this Custom Payment attempt.';
comment on column public.custom_payment_transactions.amount is
  'Major-unit amount in currency; authoritative amount verified against the selected payment gateway.';


-- =============================================================
-- migration: 20260823041512_db635dba-1b1c-4d7c-9850-a375e3fad0f1.sql
-- =============================================================

alter table public.custom_payment_transactions
  add column if not exists merchant_reference text,
  add column if not exists gateway_reference text;

update public.custom_payment_transactions
   set merchant_reference = coalesce(merchant_reference, reference),
       gateway_reference = coalesce(gateway_reference, case when payment_gateway = 'paystack' then reference else null end);

alter table public.custom_payment_links
  add column if not exists paid_gateway_reference text,
  add column if not exists paid_gateway_transaction_id text;

update public.custom_payment_links
   set paid_gateway_reference = coalesce(paid_gateway_reference, paid_reference)
 where status = 'paid';

create index if not exists custom_payment_transactions_merchant_reference_idx
  on public.custom_payment_transactions (link_id, merchant_reference);
create index if not exists custom_payment_transactions_gateway_reference_idx
  on public.custom_payment_transactions (gateway_reference);
create index if not exists custom_payment_transactions_gateway_txid_idx
  on public.custom_payment_transactions (payment_gateway, gateway_transaction_id);

create or replace function public.finalize_custom_payment_v2(
  _link_id uuid,
  _merchant_reference text,
  _gateway_reference text,
  _gateway_transaction_id text,
  _payer_name text,
  _payer_email text,
  _paid_at timestamp with time zone
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _link public.custom_payment_links%rowtype;
begin
  if _merchant_reference is null or length(_merchant_reference) = 0 then
    raise exception 'Merchant correlation key is required';
  end if;
  if coalesce(_gateway_reference, '') = '' and coalesce(_gateway_transaction_id, '') = '' then
    raise exception 'A gateway-issued identifier is required to finalize a custom payment';
  end if;

  select * into _link from public.custom_payment_links where id = _link_id for update;
  if not found then
    raise exception 'Custom payment link not found';
  end if;

  if _link.status = 'paid' then
    return (coalesce(_gateway_transaction_id, '') <> '' and _link.paid_gateway_transaction_id = _gateway_transaction_id)
        or (coalesce(_gateway_reference, '') <> '' and _link.paid_gateway_reference = _gateway_reference)
        or (_link.paid_reference = _merchant_reference);
  end if;

  update public.custom_payment_transactions
     set status = 'successful',
         gateway_reference = coalesce(_gateway_reference, gateway_reference),
         gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
         payer_name = coalesce(_payer_name, payer_name),
         payer_email = coalesce(nullif(_payer_email, ''), payer_email),
         paid_at = coalesce(paid_at, _paid_at),
         last_error = null,
         updated_at = now()
   where link_id = _link_id
     and merchant_reference = _merchant_reference;

  update public.custom_payment_links
     set status = 'paid',
         paid_at = _paid_at,
         paid_reference = coalesce(nullif(_gateway_reference, ''), nullif(_gateway_transaction_id, ''), _merchant_reference),
         paid_gateway_reference = nullif(_gateway_reference, ''),
         paid_gateway_transaction_id = nullif(_gateway_transaction_id, ''),
         updated_at = now()
   where id = _link_id;

  return true;
end;
$function$;

revoke all on function public.finalize_custom_payment_v2(uuid, text, text, text, text, text, timestamp with time zone) from public;
grant execute on function public.finalize_custom_payment_v2(uuid, text, text, text, text, text, timestamp with time zone) to service_role;


-- =============================================================
-- migration: 20260902_add_otp_session_support.sql
-- =============================================================

-- Add OTP/2FA support for authenticated browser sessions
-- Allows storing authenticated browser state to reuse across logins

-- 1. Add grant_id column to browser_auth_sessions for grant-based access tracking
ALTER TABLE public.browser_auth_sessions
  ADD COLUMN IF NOT EXISTS grant_id uuid REFERENCES public.tool_access_grants(id) ON DELETE SET NULL;

-- 2. Update status enum to include otp states
ALTER TABLE public.browser_auth_sessions
  DROP CONSTRAINT IF EXISTS browser_auth_sessions_status_check;

ALTER TABLE public.browser_auth_sessions
  ADD CONSTRAINT browser_auth_sessions_status_check
  CHECK (status IN ('starting', 'ready', 'failed', 'expired', 'closed', 'awaiting_otp', 'otp_submitted'));

-- 3. Add OTP context fields
ALTER TABLE public.browser_auth_sessions
  ADD COLUMN IF NOT EXISTS otp_context jsonb,
  ADD COLUMN IF NOT EXISTS otp_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS otp_submission_error text;

-- 4. Create table for authenticated browser sessions (cookies, tokens)
CREATE TABLE IF NOT EXISTS public.tool_account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tool_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('browser_use', 'cloudflare')),
  provider_session_id text,

  -- Captured authenticated state
  authenticated_cookies jsonb,
  session_tokens jsonb,
  auth_headers jsonb,

  -- Verification & lifecycle
  last_verified_at timestamptz,
  verification_status text NOT NULL DEFAULT 'active'
    CHECK (verification_status IN ('active', 'expired', 'invalid')),
  expires_at timestamptz,

  -- Audit
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.browser_auth_sessions.otp_context IS
  'Contains: {detected_type: "email"|"sms"|"authenticator", field_selector: "...", error: "...", attempt_count: 0}';
COMMENT ON COLUMN public.tool_account_sessions.authenticated_cookies IS
  'Array of {name, value, domain, path, expires, secure, httpOnly}';
COMMENT ON COLUMN public.tool_account_sessions.session_tokens IS
  '{accessToken?, refreshToken?, ...}';
COMMENT ON COLUMN public.tool_account_sessions.auth_headers IS
  'Common headers from authenticated requests';

CREATE INDEX IF NOT EXISTS tool_account_sessions_account_idx
  ON public.tool_account_sessions(account_id, verification_status);
CREATE INDEX IF NOT EXISTS tool_account_sessions_provider_idx
  ON public.tool_account_sessions(provider, verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS tool_account_sessions_account_provider_uidx
  ON public.tool_account_sessions(account_id, provider);

GRANT SELECT, INSERT, UPDATE ON public.tool_account_sessions TO authenticated;
GRANT ALL ON public.tool_account_sessions TO service_role;
ALTER TABLE public.tool_account_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tool_account_sessions admin all" ON public.tool_account_sessions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin') AND created_by = auth.uid());

-- Prevent users from querying other users' sessions
CREATE POLICY "tool_account_sessions deny select non-admin" ON public.tool_account_sessions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR created_by = auth.uid());

CREATE TRIGGER tool_account_sessions_touch BEFORE UPDATE ON public.tool_account_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 5. Add audit table for OTP events
CREATE TABLE IF NOT EXISTS public.browser_auth_otp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.browser_auth_sessions(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  event text NOT NULL
    CHECK (event IN ('otp_detected', 'otp_submitted', 'otp_accepted', 'otp_rejected', 'otp_timeout', 'session_expired_on_reuse')),
  otp_type text,
  error_message text,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_auth_otp_audit_session_idx
  ON public.browser_auth_otp_audit(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS browser_auth_otp_audit_account_idx
  ON public.browser_auth_otp_audit(account_id, created_at DESC);

GRANT SELECT, INSERT ON public.browser_auth_otp_audit TO authenticated;
GRANT ALL ON public.browser_auth_otp_audit TO service_role;
ALTER TABLE public.browser_auth_otp_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otp_audit admin all" ON public.browser_auth_otp_audit
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));


-- =============================================================
-- migration: 20260902_phrasly_shared_auth_hardening.sql
-- =============================================================

-- Shared-auth hardening: admin refresh + writer session rejection audit events.
ALTER TABLE public.browser_auth_otp_audit
  DROP CONSTRAINT IF EXISTS browser_auth_otp_audit_event_check;
ALTER TABLE public.browser_auth_otp_audit
  ADD CONSTRAINT browser_auth_otp_audit_event_check
  CHECK (event IN (
    'otp_detected','otp_submitted','otp_accepted','otp_rejected','otp_timeout',
    'session_expired_on_reuse','admin_refresh_started','admin_refresh_otp_required',
    'admin_refresh_succeeded','shared_session_rejected','shared_session_expired'
  ));

COMMENT ON COLUMN public.tool_account_sessions.session_tokens IS
  'Reusable non-cookie browser storage state, including localStorage/sessionStorage when captured.';
