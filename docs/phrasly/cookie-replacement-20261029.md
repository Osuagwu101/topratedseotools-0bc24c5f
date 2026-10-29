# Phrasly guest-session cookie conflict

The writer screenshot shows Phrasly's own Sign up to humanize prompt, confirming a guest page rather than a TopRated entitlement error. This predates the later revoke/reassign permission problem.

An isolated actual-Chrome test reproduced a concrete extension defect: a pre-existing host-only session cookie survived installation of a new domain cookie. Both cookies existed and Chrome selected the old cookie. This is a reproducible cause of incorrect session delivery, though the affected writer's own cookie jar has not been inspected and the screenshot alone does not prove this was his sole cause.

Writer Access extension 1.0.2 preserves hostOnly metadata, replaces stale root-domain session variants, preserves expiry metadata, and reads back the installed login cookie. Missing, expired, failed or ambiguous login-cookie installation prevents opening a provider tab. Optional cookie failures do not invalidate a successfully installed login cookie. The AWS native launch protocol, extension identity, permissions, quota handling and backend endpoints are retained. No provider security control was bypassed.

Validation: 24 worker tests, six packaging/build tests, eight actual-Chrome cookie-store checks, and eight isolated MV3 end-to-end checks. Synthetic tests perform no provider login or generation. The broken probe had two session cookies and selected the old value; after the fix there is one fresh cookie and Chrome selects it.

The authorized TopRated extension download now serves version 1.0.2. A normal password session for the diagnostic writer verified downloaded ZIP bytes; the temporary verification session was revoked. Anonymous download remains denied. All 64 processes are unchanged. The previous ZIP is retained for rollback. No payment, user permission, provider-session or other application data was modified.

Installed unpacked extensions do not update from a server ZIP automatically. The writer must download the updated TopRated Access extension, extract its files into the existing extension folder, and click Reload in chrome://extensions or edge://extensions. Close existing Phrasly tabs, then launch through TopRated again. The signed-in provider result remains to be verified by the writer; the earlier automated provider test was blocked by its security-verification page.
