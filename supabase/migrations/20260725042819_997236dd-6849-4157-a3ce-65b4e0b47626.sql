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