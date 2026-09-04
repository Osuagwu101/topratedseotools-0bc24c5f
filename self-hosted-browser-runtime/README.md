# Top Rated Browser Runtime

Portable self-hosted browser runtime for Top Rated SEO Tools.

## Phase status

**Phase 2 browser lifecycle is implemented and CI-validated.** The isolated browser worker can launch Chromium, attach through the Chrome DevTools Protocol (CDP), navigate deterministic harmless test pages, report session state, stop Chromium cleanly, and verify that no tracked Chromium processes remain after repeated lifecycle cycles.

This phase still does **not** implement viewer streaming, production routing, Phrasly authentication/session injection, writer access, scheduling, or production integration.

## Architecture

- `api/` — Laravel control-plane skeleton; still isolated from production.
- `browser-worker/` — Node.js worker that owns the generic Chromium lifecycle and CDP control surface.
- `docker-compose.yml` — portable Linux + Docker runtime; the browser worker uses an init reaper for process hygiene.
- `docs/audits/` — phase audits and root-cause evidence.

The browser core is intentionally tool-agnostic. Phrasly is not hardcoded into this runtime.

## Phase 2 worker endpoints

- `GET /health` — worker health and Chromium availability.
- `GET /browser/status` — active/inactive browser lifecycle state.
- `POST /browser/start` — launch one isolated Chromium process and optionally navigate to a supplied `http`, `https`, or `data:text/html` URL.
- `POST /browser/navigate` — control the active Chromium page over CDP.
- `POST /browser/stop` — terminate Chromium, reap the process tree, remove the temporary profile, and report orphan/zombie checks.

The single-session worker surface is deliberate for Phase 2. Multi-session scheduling and isolation belong to later phases.

## Local bootstrap

```bash
cp .env.example .env
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
curl http://127.0.0.1:18081/browser/status
docker compose down -v --remove-orphans
```

Expected health responses identify `control-plane` and `browser-worker` with phase `2`. The worker reports `control: "cdp"` and confirms whether Chromium is installed.

## Financial and hosting rule

Production is designed for fixed-price Linux VPS capacity. The runtime must not depend on per-browser, per-minute, or per-hour browser infrastructure.

## Safety rule

The existing Browser Use production implementation remains untouched. This branch continues independent browser-runtime validation only; production integration is reserved for the later integration phase.
