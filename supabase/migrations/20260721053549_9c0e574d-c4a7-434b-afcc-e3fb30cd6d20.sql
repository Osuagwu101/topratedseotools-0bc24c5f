
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
