
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
