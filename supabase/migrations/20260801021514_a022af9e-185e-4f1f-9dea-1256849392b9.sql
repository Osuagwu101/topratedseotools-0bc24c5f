UPDATE public.email_templates
SET html_body = replace(
  html_body,
  '<p style="margin-top:8px;font-size:13px;color:#475569">{{currency_note}}</p>',
  '<p style="margin-top:8px;font-size:13px;color:#475569">{{coupon_note}}</p><p style="margin-top:4px;font-size:13px;color:#475569">{{currency_note}}</p>'
)
WHERE key = 'payment_success'
  AND html_body LIKE '%{{currency_note}}%'
  AND html_body NOT LIKE '%{{coupon_note}}%';
