# AWS URL-only copy

The original live AWS writer ZIP is retained in reference/phrasly-aws-url-only/writer-original.zip. The original four Admin extension files are retained under admin-original.

Writer: all 12 files, all ZIP member paths, the original version and the extension key are preserved. The only payload substitutions are https://app.topratedseotools.com.ng → https://topratedseotools.com and the associated topratedseotools.com.ng domain text → topratedseotools.com.

Admin: the four supplied Jawad Ahmed EXR files are unchanged. Its original Copy Cookies as JSON workflow replaces the custom Admin exporter. The original heading, cookie display and manifest are retained.

Removed from the writer: configuration wrapper, readiness/ping message, staging runtime flags, altered cookie installation, extra package files and version changes. The TopRated website now requests the existing handoff and sends the original trst_access message directly.

The application still uses the existing TopRated authentication and backend endpoints. This change does not replace the storefront, its user database or its payment system. Existing Phrasly account data, grants and limits are retained.

The mandatory byte comparison fails on any extension payload change outside the declared domain replacements. It also checks that the writer contains exactly 12 files, the Admin extension exactly four, and the writer archive retains its original member list.

This confirms the copied extension payloads and their handoff protocol. It does not claim successful Humanizer/Detector processing in profiles that are signed out of TopRated or lack assigned access.




The Admin Cookie-Based Tools page now uses the six original AWS PHP templates rendered with synthetic data to obtain the original HTML structure. The browser data binding supplies the existing TopRated account records to those fields. Original sidebar, logo, typography, theme toggle, populated cookie JSON, capacities, usage totals, Save, Add Account, and unused-account Remove confirmation are preserved. Only page/asset URLs are mapped to TopRated.

The independent reference screen is rendered directly by the original PHP with matching synthetic account data. Browser checks measured a 0px maximum difference in the sampled layout geometry and passed Save/Add/Remove, theme and mobile menu behavior. No real accounts were added, edited or removed during these tests.

The existing TopRated authentication/database adapter remains responsible for authorizing Admin and reading/writing the existing encrypted account storage. Raw JSON is returned only for the authenticated owner view requesting interface=aws. The default Admin API remains sanitized. Account removal refuses assigned records, including a concurrent assignment protected by the verified PostgreSQL foreign key.

No schema, balances, credits, or existing account/assignment data are changed by deployment.
