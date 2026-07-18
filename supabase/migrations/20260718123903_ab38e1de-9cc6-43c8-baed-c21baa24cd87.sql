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