# AWS Admin parity rebuild — 29 October 2026

Source: original AWS /var/www/platform/public/cookie-tools.php and the supplied Jawad-Ahmed-EXR.rar.
The AWS source has per-account label/URL/capacity fields, cookie JSON, assignment counts, Save and Add Account. The earlier TopRated page only edited a selected existing account.

Implemented: account rows, account creation, native URL validation, capacity and usage indicators, blank-cookie metadata saves that retain encrypted sessions, dedicated Admin navigation, and the original EXR popup structure with TopRated branding. Export permission remains restricted to Phrasly. Values stay masked in the popup; Copy Cookies as JSON and the authenticated Admin handoff preserve the full bundle.

Preserved: existing owner authorization, encrypted storage, writer entitlements, unlimited settings, and today's root-session validation. No database schema, payment, credit or balance changes are required.

Validation: 12 backend/import tests passed; six browser checks passed; production Vite build passed. A clean Chrome-extension profile installed the login cookie and opened phrasly.ai/dashboard/humanizer, but the provider showed a Cloudflare security verification page. Native authenticated Humanizer/Detector processing is NOT verified by that test. This rebuild must not be described as resolving the original login problem until a clean ordinary writer profile completes real processing.

The current writer extension remains unchanged by this Admin deployment. AWS account-removal behavior is not added; enabled/disabled account controls remain available without deleting records.
