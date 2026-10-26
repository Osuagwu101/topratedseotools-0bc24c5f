# Customer Phrasly entry correction — 26 October 2026

Status: prepared; awaiting production activation and public customer-path acceptance.

The previous Phase 6 verification covered the separate /phrasly route. It did not establish that the existing customer "Launch Phrasly" button used that route or that the customer's normal dashboard offered extension installation. The owner correctly identified that the retained storefront could still open the provider's unauthenticated website. The earlier complete claim did not cover the actual customer journey.

The correction adds the AWS-style extension download panel and explicit Chrome/Edge/Brave installation steps to /dashboard and /tools/phrasly. Downloading automatically expands the steps. The existing Launch Phrasly button invokes the original AWS handoff; a missing extension shows installation guidance instead of opening a provider login/signup tab. The tool page also exposes native Humanizer and Detector access buttons. The independent /phrasly entry retains automatic native opening and now also offers installation help, including /phrasly?setup=1.

The existing storefront process remains on port 3124. A small first-party bootstrap attaches the Phrasly panel to its existing page, including client-side navigation, and intercepts only the legacy Phrasly launch. It is inserted before customer clicks can run the old handler. The module uses the same TopRated customer auth storage as the actual login page and the existing protected Phrasly endpoints. Native provider processing, extension bodies, encrypted cookies, grants, attempts and financial records remain unchanged.

Public frontend files are installed separately and served directly by Nginx. Only the retained storefront's head insertion and the Phrasly asset location change. The existing GA4 insertion is preserved. A protected full Nginx snapshot supports immediate rollback, without restarting an application or changing database data.

Staged checks verified the actual TopRated password login, missing-extension behavior on the real Launch Phrasly button, visible installation steps, an exact enabled ZIP download, the dashboard panel, and real catalog-to-tool navigation. A separate installed-extension check verified the real legacy button opening the authenticated native Humanizer and the tool page opening the authenticated Detector. No page errors or provider generation occurred. Native opening can take time; acceptance permits three minutes for handoff and editor readiness.

Public activation and a single complete public run are still required. Do not treat staged HTML/assets as a completed deployment.
