# Native Phrasly entry correction

The owner clarified that writers must go directly into the native Phrasly experience, without an additional TopRated Phrasly writer dashboard. The deployed Humanizer and Detector already open the real phrasly.ai pages; the extra TopRated writer workspace was an unnecessary launcher screen.

Runtime correction commit 10568a7272ca9211c9d465a4bc45c07a45dbd255 changes the writer page into an automatic handoff. A signed-in authorized writer with the extension is sent directly into the native Humanizer tab. /phrasly?feature=ai_detector selects the native Detector instead. Only sign-in, missing-extension setup and errors are shown when necessary. The owner administration remains separate. No processing UI, editor, iframe or provider API is recreated on TopRated.

CI on that correction passed: AWS parity 40306535677, frontend/Chromium contract checks 40306535780, cross-service/build 40306535722. The public acceptance script was updated in 6191f7c5368f5e49b307d71f2875774d62d89549 to assert automatic native launch and absence of the extra writer dashboard.

Status: CODE READY; NOT DEPLOYED. The authorized Desktop Commander device stopped answering process commands (including a hostname read); the connector returned MCP request timed out. It remained listed Online with an increasingly stale last-seen time. No unverified deployment was performed. The active runtime remains a264d5fd9b18209e008ca015a86e7cdcad7becef, whose launch buttons already open native Phrasly but whose extra writer launcher screen is still present.

Resume: reconnect the authorized device, update/build the existing Phase 6 checkout without resetting unrelated local changes, stage a new verified artifact, update only the Phrasly release, and run the updated public native-launch acceptance test. Preserve the existing Admin controls, provider account cookies, daily counters, rollback snapshot and unrelated services. Do not claim this UX correction is live before verification.
