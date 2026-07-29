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