# Phrasly Admin import validation repair

The owner reported generic bad_cookie_json after a successful 20-cookie handoff. The actual incoming secrets were not inspected, so the screenshot does not establish the exact failing check. Investigation reproduced an exporter/save contract mismatch: Chrome may hold host-only and domain session variants; the exporter sent all, while the parser required exactly one.

Admin exporter 1.0.1 now exports Chrome cookies.get selected root login when several session variants exist, using the active tab cookie store. Other cookies and metadata are retained. Identity, permissions, one-use handoff and origin checks are unchanged. Users must download the updated Admin exporter and replace/reload its existing unpacked folder. This is separate from writer Access extension 1.0.2.

The save parser collapses identical root login values, ignores non-root session variants when a valid root exists, and rejects conflicting root identities without guessing. Missing and ambiguous root logins now have distinct, actionable messages. No provider session, customer assignment, financial data or stored cookie value was changed by deployment or tests.

Validation: six parser tests, 28 exporter security tests, nine actual Chrome import/save checks with conflicting host/domain login fixtures and the real parser, 24 writer worker regressions, and nine checks of live public assets with mocked private APIs. No provider network calls or signed-in native provider claim. The updated Phrasly runtime is isolated on port 3342; only the 11 Phrasly upstream routes changed. Prior runtime and exporter ZIP retained for rollback; all pre-existing processes preserved.
