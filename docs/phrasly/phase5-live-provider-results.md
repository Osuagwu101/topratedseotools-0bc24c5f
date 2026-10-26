# Phase 5 live provider tests — 26 October 2026

The real-provider processing acceptance gate passed using 50 words. Production activation remains separate.

Input: A community garden helps neighbours work together and learn practical skills. People share seeds, water plants, and care for the soil. Over time, their efforts produce fresh vegetables and create a peaceful place where families can meet, relax, and connect. Each shared task builds trust and strengthens the local community.

Test path: actual PhraslyOneClickActions website component, compiled Nitro backend, destination Supabase Auth/database, original AWS-identity MV3 extension, complete encrypted AWS cookie bundle, native Phrasly editors. First-party HTTPS was isolated loopback staging; native provider requests went to the real service without substituted responses.

- Humanizer: /api/ai/rewrite returned HTTP 200 and a 951-byte streamed rewrite containing generated sentence variations. Response SHA-256 642f4bd19bfd3a7e4234dac60a23b1ff5d88efd10e07f55a4cc015a60dc9d7f2. Run began 09:16:32 UTC.
- Detector: /api/ai/detect returned HTTP 200, success:true, allowed:true. The follow-up visible native results showed 100% AI generated, 0% Human, 4/4 sentences likely AI generated. The application showed 50 words. The final detector run began 09:18:59 UTC. Response SHA-256 afd53989bfabfc29f2e312c4866af3721631bf8de8ede5e3c47ff76d47af2499.
- Destination session bootstrap, handoff, fulfillment, popup identity and usage endpoints returned HTTP 200.
- Verified database usage totals after all diagnostic attempts: humanizer 9, ai_detector 2, WAT day 2026-10-26. These are request-attempt totals across retries, not successful-generation totals.

Observed AWS behavior: substring interception includes /api/ai/rewrite/lang and provider retries. A one-request fixture allowance therefore blocked generation after language detection. Only the internal acceptance writer's feature allowance was raised to 20; no customer allowances, financial balances or payment records were modified. Counters were not reset. Native Phrasly initially returned Captcha required; its own application completed its normal retry, then returned the successful rewrite. No CAPTCHA-solving automation or replacement API was introduced.

Operational setup: the three existing Phase 3 migrations were applied transactionally; seven new server-only tables have RLS with anon/authenticated read denied, and both RPCs deny anon/authenticated execution. Raw account snapshots, credentials, signed tickets and browser profiles are excluded from this report and Git.

Scope: real Humanizer output and real Detector score are verified. This result does not by itself certify all remaining Phase 5 failure/concurrency cases or authorize a production route switch. No production website activation occurred.
