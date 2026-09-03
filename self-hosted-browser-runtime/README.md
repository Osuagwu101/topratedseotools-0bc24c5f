# Top Rated Browser Runtime

Portable self-hosted browser runtime for Top Rated SEO Tools.

## Phase status

This repository scaffold is **Phase 1 only**. It establishes the isolated control plane, browser-worker service, Chromium-capable container image, Docker Compose topology, health checks, audit structure, and CI validation. It does **not** yet implement browser launch/session lifecycle, viewer streaming, Phrasly logic, or production integration.

## Architecture

- `api/` — Laravel control-plane API.
- `browser-worker/` — Node.js worker that will own Chromium/CDP operations in later phases.
- `docker-compose.yml` — portable Linux + Docker runtime.
- `docs/audits/` — phase audit and root-cause evidence.

The browser core is intentionally tool-agnostic. Phrasly is not hardcoded into this runtime.

## Local bootstrap

```bash
cp .env.example .env
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
docker compose down -v --remove-orphans
```

Expected health responses identify `control-plane` and `browser-worker` with phase `1`.

## Financial and hosting rule

Production is designed for fixed-price Linux VPS capacity. The runtime must not depend on per-browser, per-minute, or per-hour browser infrastructure.

## Safety rule

The existing Browser Use production implementation is not modified by this project until the later integration phase after independent validation.
