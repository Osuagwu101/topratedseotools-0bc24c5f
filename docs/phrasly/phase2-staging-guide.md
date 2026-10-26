# Phase 2 reproduction guide

Use a separate checkout and disposable browser profile. The package retains the original AWS cookie/session workflow, popup and public extension identity. It defaults to disabled and is not connected to production routes.

## Dependencies

The CI workflow pins Node 22.23.2, Bun 1.4.4 and Playwright 1.58.2 with its Chromium build. Python 3 standard-library tools build the package and verify source. The unchanged PHP backend rehearsal requires PHP CLI with `pdo_sqlite`; it uses synthetic users, an isolated database, a fresh signing secret, local session files and a loopback server. The application uses the existing committed lockfiles.

## Source, protocol and packaging checks

From the repository root:

```sh
python3 scripts/phrasly/verify-aws-extension-source.py
node --experimental-strip-types --test tests/phrasly-extension-protocol.test.ts tests/phrasly-extension-worker.test.cjs tests/phrasly-extension-launcher.test.ts
python3 tests/phrasly-extension-build.test.py
```

In the [private AWS source checkout](https://github.com/Osuagwu101/topratedseotools.com.ng-source/blob/4c420f5d054653d4dc3eb12ecf74e0508556b184/reference/phrasly-oneclick/aws-canonical/README.md), run the original-backend checks separately:

```sh
python3 scripts/phrasly/verify-aws-backend-source.py
python3 tests/phrasly-extension-aws-backend.test.py
```

The PHP test runner supplies all database paths and secrets itself. Do not configure it with operational credentials. It copies canonical source to a temporary directory and deletes that directory after the test.

## Actual MV3 browser rehearsal

Install browser dependencies outside the repository, then run the tests:

```sh
npm install --prefix /tmp/phrasly-browser --ignore-scripts --no-package-lock --no-save --no-audit --no-fund playwright@1.58.2
node /tmp/phrasly-browser/node_modules/playwright/cli.js install --with-deps chromium
NODE_PATH=/tmp/phrasly-browser/node_modules node --experimental-strip-types --test tests/phrasly-extension-browser.test.cjs
```

The browser tests use a local TLS fixture and a loopback proxy that only accepts the two fixture hostnames and has no upstream forwarding path. Every provider/session value is synthetic. They install the real MV3 manifest and test cookie login, HttpOnly cookies, popup identity and launch, both native actions, menu hiding, blocked navigation, quota cleanup/countdown, revocation, untracked tabs, reusable handoffs, failed-processing attempt accounting and a disabled package. They do not contact Phrasly or establish real processing.

The original public manifest key fixes the extension ID to `lpgnjkafilbopdojcfnagooojifkccek`. Keep the original extension out of the disposable staging profile, since two installations with the same ID cannot coexist.

## Build a reproducible package

```sh
python3 scripts/phrasly/package-native-extension.py --origin https://topratedseotools.com --out /tmp/TopRated-Phrasly-OneClick-staging.zip
```

Output must not already exist. The ZIP contains 13 deployment files plus `BUILD-MANIFEST.json`, with fixed ZIP metadata and per-file hashes. It is disabled by default: `enabled:false` and no static content scripts. The source has the original AWS wildcard host permission because that is required for the original cookie workflow. No active cookie or credential is embedded.

For a later isolated staging install after the backend exists:

```sh
python3 scripts/phrasly/build-native-extension.py --origin https://YOUR_STAGING_DOMAIN --out /ABSOLUTE/NEW/DIRECTORY --enabled
```

`--enabled` restores the original static content scripts and cookie workflow. It does not create backend handlers, account records, subscriptions or a first-party session bridge. Staging and rollout remain later phases.

## Website and backend integration

`createPhraslyLauncher` takes the extension ID, Chrome runtime and an authenticated `requestHandoff(feature)` callback. It checks readiness first and sends the original `trst_access` message once. A lost reply returns `launch_state_unknown`; it does not automatically retry the launch. An `ok:true` reply reports the worker's launch result, not independently verified provider login or processing.

Use [the backend handoff](phase2-backend-handoff.md) for exact GET/POST fields, cookie-account allocation, first-party popup session transport and identity/storage adaptation. `config/phrasly-extension.env.example` records the intended deployment settings; the current production launch path does not consume them yet.

The website workflow verifies extension source bytes, runs the component/browser/build tests, typechecks the two TypeScript modules, creates a disabled package and compiles the application with dummy configuration. It has no deployment step and no production credentials.

The private source repository has its own `Phrasly authoritative AWS backend` workflow for the original-source/schema verifier, PHP syntax and ten isolated backend tests. Raw backend source and the original archive stay in that private repository.
