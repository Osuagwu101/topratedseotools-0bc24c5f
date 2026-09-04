# Top Rated Browser Runtime

Portable self-hosted browser runtime for Top Rated SEO Tools.

## Phase status

**Phase 3 secure viewer is implemented and CI-validated on the isolated Phase 3 branch.** The browser worker can launch Chromium, control it internally over loopback-only CDP, serve a restricted screenshot/input viewer, accept mouse/keyboard/scroll interaction, reconnect to the same running browser session, and clean Chromium up without tracked orphan or zombie processes.

Phase 3 does **not** implement the Phase 4 Laravel session API, multi-session scheduling, writer ownership/isolation, tool profiles, Phrasly authentication/session injection, production routing, or any provider switch in the live Top Rated SEO Tools application.

The existing Browser Use production implementation remains untouched.

## Architecture

- `api/` — Laravel control-plane skeleton; still isolated from production. Phase 4 session orchestration is not implemented yet.
- `browser-worker/` — Node.js worker that owns generic Chromium lifecycle, internal CDP control, frame capture, and the restricted viewer input surface.
- `docker-compose.yml` — portable Linux + Docker runtime; the browser worker uses an init reaper and is published to host loopback only for the current local/CI topology.
- `docs/audits/` — phase audits and root-cause evidence.

The browser core is intentionally tool-agnostic. Phrasly is not hardcoded into production runtime source.

## Phase 3 worker endpoints

Browser lifecycle/control endpoints used by the isolated test harness:

- `GET /health` — worker health, Chromium availability, and viewer security capability.
- `GET /browser/status` — active/inactive browser lifecycle state.
- `POST /browser/start` — launch one isolated Chromium process and return a short-lived secure viewer grant.
- `POST /browser/navigate` — internal Phase 2/3 test control endpoint for the active Chromium page.
- `POST /browser/stop` — terminate Chromium, reap the process tree, remove the temporary profile, and report orphan/zombie checks.

Restricted viewer endpoints:

- `GET /viewer/{sessionId}` — viewer shell. The bearer token is not embedded into this HTML response.
- `GET /viewer/{sessionId}/status` — authenticated browser metadata used by the viewer.
- `GET /viewer/{sessionId}/frame` — authenticated JPEG browser frame.
- `POST /viewer/{sessionId}/input` — authenticated restricted input contract supporting only mouse, scroll, text, and key events.

The single-session worker surface remains deliberate at Phase 3. Per-writer ownership, multi-session isolation, lifecycle leases, and scheduling belong to later Blueprint phases.

## Viewer security model

- Viewer grants are HMAC-SHA256 signed and bound to one browser session ID.
- Default viewer-token lifetime is 300 seconds; configured lifetime cannot exceed 900 seconds.
- `VIEWER_SIGNING_SECRET` must be at least 32 bytes.
- Initial viewer token transport uses a URL fragment (`#token`), so it is not sent to the server as part of the initial viewer-shell request or query string.
- The viewer stores the grant in `sessionStorage`, removes the fragment from the visible URL, and sends subsequent authorization as a Bearer token.
- Missing, forged, expired, and cross-session viewer authorization is rejected.
- Viewer responses use no-store/no-referrer and restrictive browser security headers.
- The writer-facing viewer does not expose a raw CDP URL, DevTools UI, shell, Docker control surface, or unrestricted command endpoint.
- Chromium's CDP listener is internal and bound to `127.0.0.1` on a dynamic port inside the worker environment; Docker does not publish a raw CDP port.

TLS is not claimed by the localhost Phase 3 test environment. HTTPS/TLS termination is validated later when the portable runtime is deployed behind the intended VPS reverse proxy.

## Local bootstrap

Create an environment file and replace the example signing secret with a random secret of at least 32 bytes before starting the runtime:

```bash
cp .env.example .env
# Edit VIEWER_SIGNING_SECRET in .env before startup.
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
curl http://127.0.0.1:18081/browser/status
docker compose down -v --remove-orphans
```

Expected health responses identify `control-plane` and `browser-worker` with phase `3`. The worker reports `control: "cdp"` for its internal browser control and a restricted viewer capability with `rawCdpExposed: false`.

## Phase 3 validation

The Phase 3 CI gate verifies:

1. worker unit tests and source/config syntax;
2. generic production runtime source;
3. Docker build and isolated boot;
4. localhost-only worker publication and no raw `9222` CDP mapping;
5. secure viewer headers and token nondisclosure;
6. missing/forged/cross-session authorization rejection;
7. authenticated frame capture;
8. real mouse click, keyboard/text, and scroll behavior against a deterministic page;
9. repeated reconnect to the same browser session and PID;
10. rejection of unsupported shell-style input;
11. clean browser stop with no tracked orphan/zombie Chromium processes;
12. independent post-stop Chromium process scan; and
13. complete Docker Compose teardown.

See `docs/audits/phase-3.md` and `docs/audits/ISSUE_REGISTER.md` for the full evidence and failure history. The first Phase 3 CI attempt was red because the generic-source grep incorrectly included a negative test fixture; that harness defect was corrected and retained in the issue register rather than hidden.

## Known Blueprint conformance issue

The Master Blueprint calls for the self-hosted browser runtime to live in its own repository. The connected GitHub action set available during these phases does not expose repository creation, so the runtime is still isolated under `self-hosted-browser-runtime/` on dedicated, unmerged branches in the existing repository. This inherited issue is tracked as `SB-001-001` and prevents a claim of full repository-topology conformance until the separate repository is created and the relevant CI is rerun there.

## Financial and hosting rule

Production is designed for fixed-price Linux VPS capacity. The runtime must not depend on per-browser, per-minute, per-session, per-request, or per-hour browser infrastructure.

## Safety rule

The existing Browser Use production implementation remains untouched. This branch continues independent browser-runtime validation only. Production integration is reserved for the later Blueprint integration phase; Phase 4 has not been started here.
