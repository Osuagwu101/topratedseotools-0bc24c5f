# Phase 2 extension staging package

This guide builds and tests the recovered extension's first-party components in a separate checkout. It does not enable the current website, deploy a release, or authenticate a provider account. The existing public/login/admin releases must retain their separate routes.

## Dependencies and configuration

| Component | Dependency | Scope |
| --- | --- | --- |
| Protocol | Node 22.23.2 built-in crypto | Server only; 60-second handoff and four-hour record capability |
| Website bridge | Browser Chrome runtime messaging | Calls the configured extension; delegates handoff issuance to an authenticated callback |
| Extension | Chrome Manifest V3, storage API | No npm packages, remote scripts, cookie permission or embedded provider credentials |
| Build/package | Python 3.12+ standard library | Fixed file allowlist, UTF-8/LF, fixed ZIP metadata, no compression variability |
| Browser contract test | Playwright 1.58.2 and Chromium 145.0.7632.6; OpenSSL | Disposable development/CI dependency, outside application package/lockfiles |
| Application compile | Bun 1.4.4 with existing `bun.lock` | Preserve the known lockfile; the inherited npm lock is stale |

| Variable or build input | Visibility | Purpose / current state |
| --- | --- | --- |
| Builder `--origin` | Public | Exact first-party HTTPS hostname; rewrites sender/host scope and dashboard link |
| Builder/package `--enabled` | Public | Explicit staging opt-in; omitted by default and in the downloadable package |
| `PHRASLY_EXTENSION_ENABLED` | Server configuration | Future backend feature flag; keep false until Phase 3 gates exist |
| `PHRASLY_HANDOFF_SECRET` | Server secret | New random value of at least 32 bytes; never reuse AWS's signing secret |
| `PHRASLY_EXTENSION_ORIGIN` | Public allowlist value | Exact `chrome-extension://NEW_ID` for future backend requests |
| `VITE_PHRASLY_EXTENSION_ID` | Public browser configuration | Planned website binding to the new extension; no current live launch binding |
| Existing Supabase configuration | Existing server/client boundaries | Phase 3 uses verified account/access state; the service-role key stays server only |

The environment example is [config/phrasly-extension.env.example](../../config/phrasly-extension.env.example). The library and example do not, by themselves, wire any HTTP handlers or change the live `launchTool` function.

No new paid processing service has been configured or provisioned. The recovered native workflow uses the provider's own browser page and account. Current provider account permissions, plan and cost were not independently established in this phase; a TopRated entitlement does not grant provider permission. Do not infer provider authentication from a successful first-party handoff.

## Build an unpacked extension

In a clean branch checkout:

```sh
node --experimental-strip-types --test tests/phrasly-extension-protocol.test.ts tests/phrasly-extension-worker.test.cjs tests/phrasly-extension-launcher.test.ts
python3 tests/phrasly-extension-build.test.py
python3 scripts/phrasly/build-native-extension.py --origin https://YOUR_STAGING_DOMAIN --out /ABSOLUTE/NEW/EXTENSION_DIRECTORY
```

The destination must not already exist. The builder copies only the seven reviewed extension files, accepts a plain HTTPS DNS origin on port 443, and writes a disabled configuration by default. It does not import anything from a browser profile, AWS environment file, ZIP containing active state, or customer record.

Load the new directory through Chrome's unpacked-extension control in a dedicated test profile. Record the newly assigned extension ID. The recovered AWS manifest key and published extension ID are intentionally not reused. This manual procedure is for a new staging profile; the automated browser proof separately loads the actual manifest into a disposable Chromium profile.

Keep the package disabled on a real site until the Phase 3 handoff, redemption and quota handlers are implemented. Merely enabling it will not create those endpoints or log into Phrasly.

## Produce and verify a portable ZIP

```sh
python3 scripts/phrasly/package-native-extension.py --origin https://YOUR_STAGING_DOMAIN --out /ABSOLUTE/NEW/TopRated-Phrasly-OneClick-staging.zip
```

The output JSON includes the archive's SHA-256. Inside the ZIP, `BUILD-MANIFEST.json` lists the origin, enabled flag, extension version, byte size and SHA-256 of every shipped source file. Entries have fixed order, time and permissions. Existing archives are never overwritten. Packaging tests rebuild twice and compare complete archive bytes and each manifest entry.

The branch workflow publishes a disabled `.com` package as the `phrasly-extension-staging` artifact, retained for 14 days. It is source packaging, not a Chrome Web Store release or production installation.

## Website bridge binding for Phase 3

`src/lib/phrasly-extension/launcher.ts` exports `createPhraslyLauncher`. Bind it to the browser runtime, the new public extension ID and a `requestHandoff(feature)` callback that uses the site's verified authentication. The callback returns only `{payload, signature}`. Supabase bearer credentials must not be sent to the extension.

The bridge probes the extension before requesting a handoff. Missing, disabled or incompatible extensions fail before issuance. It sends the original `trst_access` fields once. A lost launch response returns `launch_state_unknown`; it does not automatically replay a consumed handoff. The worker stores its record capability in an `about:blank` tab before navigating to the native page, avoiding an initial untracked-request race.

The current live launcher still references the retired proxy; it has not been switched. The new bridge is a separately tested component ready for that later binding.

## Real-browser contract rehearsal

The workflow installs Playwright into its temporary directory, installs Chromium only in the disposable runner, and runs:

```sh
NODE_PATH=/ABSOLUTE/TO/ISOLATED/node_modules node --experimental-strip-types --test tests/phrasly-extension-browser.test.cjs
```

The test generates a short-lived local TLS certificate and synthetic test account/capabilities. A loopback CONNECT proxy accepts only the two fixture hostnames and sends both to the local TLS server. Other destinations are denied; the proxy contains no upstream forwarding path. Temporary certificate files, browser profiles and servers are removed after testing. Certificate-error suppression exists only in this isolated fixture.

This exercises the installed service worker, static MAIN/isolated content scripts, real website-to-extension messages, native action hooks, usage denial and countdown. The fixture's synthetic handlers model one-use redemption, per-feature counts and revocation. They are not the production handlers, database transactions, login state or provider service. No provider contact, login, paid action or real text processing occurs.

Phase 3 still needs actual authenticated handlers, fresh entitlements, transactional counters, action deduplication, revocation and a decision that satisfies the existing provider-session restriction. Phase 4 needs the real website controls/popup/onboarding and stable extension distribution. Phase 5 proves authorized processing; Phase 6 governs any separately authorized rollout.
