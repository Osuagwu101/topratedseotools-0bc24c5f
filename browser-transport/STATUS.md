# QuillBot OneClick - live Paraphraser - 2026-11-15

Native Paraphraser is live at https://quillbot.topratedseotools.com.
Assigned writers refresh TopRated dashboard and click the active QuillBot card. Public catalogue visibility is unchanged.

Verified: two fresh writer contexts, Premium authentication, visible successful concurrent paraphrases, no provider signup dialog, separate encrypted saved history and history persistence after reload. Editor buffers reset on reload; saved results remain in My history.
Actual dashboard card -> one-time handoff -> native Premium editor passed against public DNS.
Cross-writer operations/history rejected; provider account/shared history endpoints denied.
Default 25 submissions/day, Africa/Lagos reset. Immediate custom quota enforcement (429) and active-session suspension (401) passed.
Five control tests pass. Unsigned Admin 401 and writer-as-Admin 403 passed. Positive Admin UI login not separately exercised.
Admin quota and suspend/restore controls: /__qbtest/__trst/admin.
No customer balances/payments changed. Disposable validation grants and sessions revoked after acceptance.

Production: PM2 trst-quillbot-oneclick on 3023; dedicated authenticated browser CDP 9226 and private bearer relay 6102.
Private profile /var/lib/trst-quillbot-browser/profile preserved. Display/browser/relay units enabled for boot.
Actual authenticated paid readiness checked. Provider credentials remain private. Native client core adapter pinned by hash, fails closed on changed version.
Daily usage and encrypted history: .secrets/quillbot-writers.sqlite. Secrets and QA credentials ignored by git.
Original main routing retained: main app 3276, info/Phrasly 3345.
Scoped dashboard bridge quillbot-oneclick-cda6c7f6d523.js served from unified assets via existing Nginx HTML filter.
Private pilot, experimental main builds and acceptance browser stopped; pilot listener removed. Legacy gateway 3021 unchanged.
QuillBot tool_settings OneClick enabled; purchased/granted access enforced.

Scope: Paraphraser verified. Other QuillBot sections (Grammar Checker, plagiarism, Humanizer, projects, uploads) remain unverified and must not be advertised as supported.
Browser login can expire and require owner reauthentication. Provider service quotas remain applicable.
QA loopback DNS mapping caused Local Network Access rejection; removing test mapping and using public DNS passed.

Rollback configs: /home/ubuntu/deploy-backups/quillbot-parity-20261115-124332
Restore main.conf and quillbot.conf, nginx -t/reload; set QuillBot one_click_auth_enabled=false. Retain data and owner profile.
Do not stop original main 3276/info 3345. Unused main-launcher.patch/main-dashboard.patch are experimental alternatives, not live.

## Reverification in this session
Two new disposable writer accounts completed concurrent real paraphrases over public DNS. Premium identities, one-time ticket replay rejection, separate saved history, cross-writer history and operation rejection, writer-as-admin rejection, and immediate quota enforcement passed. Nine local control and relay tests passed. Connected Chrome opened the native editor without provider login and displayed the writer-specific daily counter. Main continues using the scoped dashboard bridge; the canonical main launcher is not replaced by this snapshot.
