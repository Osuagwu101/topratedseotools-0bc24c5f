# Phrasly Phase 1 source baseline

Captured on 25 October 2026. This branch prepares the existing TopRatedSEOTools.com application for Phrasly work. It does not enable Phrasly processing or deploy a release.

## Branch base

- Repository: `Osuagwu101/topratedseotools-0bc24c5f`.
- Base commit: `663f59675300183fa738f7f5eb43841f536d2bb9` from `turnitin/phase4-phase5-admin-20261024`.
- Main was separately pinned at `28c9e1d1058b73be11056af94522b2758fe66de8`.
- Dedicated branch: `phrasly/phase1-baseline-20261025`.
- Published history and the existing working checkouts are preserved.

The live admin release has 376 build-relevant files matching the base commit, zero missing files, three changed files and five additional source files. This commit records those eight exact source files. They preserve deployed functionality, including existing Turnitin administration, before any Phrasly changes. They are not new Phrasly features.

## Exact source snapshot

| File | SHA-256 |
| --- | --- |
| `src/integrations/supabase/client.ts` | `d5e7a06a58de9f0c8ee6c00540e100d4a25f211a33782a70d015b805e43c0206` |
| `src/lib/brand-assets.ts` | `3725675956155ef47f0b70fc514101146b9593499e483c56a9eda9a86bcd1369` |
| `src/routeTree.gen.ts` | `12c61724e74176d2f79f1943e65432b27ca56dbd1a2f3bd8cefdf1a8b51f782f` |
| `src/lib/turnitin-admin-purchases.functions.ts` | `edd30149af6c32df199c583f112b3f26ccd10c8b4e5331d6fe213975ebdb3466` |
| `src/lib/turnitin-admin-phase2.functions.ts` | `dd6a1a45d518d7b174598deb24a1a0567c16f221787c19885c4d4971f0c6ef10` |
| `src/lib/turnitin-admin-credit-overview.functions.ts` | `3a8a7e15386dd3c1907fe1d712c02e04648abbd01e2ef30c2d6d4e78c5ab7e85` |
| `src/routes/admin.turnitin.tsx` | `ffa8701a7fd65202e029b33c08b3268b662e97e7ec9b29ef722332dcb9655233` |
| `src/routes/admin.turnitin-credits.tsx` | `5ea0c2ffba1898cc6769262e14c7811322e021594b0c1647858087c400782147` |

The generated route tree is included because the live release contains routes absent from the Git branch. A later build may regenerate it; that does not change this snapshot's provenance.

## Scope and review

The added source contains UI components, generated route declarations, first-party Supabase clients and existing admin query functions. Admin functions require authenticated context and an administrator role. No customer records, payment records, session cookies, database secrets, private keys or provider credentials are included in this snapshot.

The production Supabase URL and publishable browser key already delivered to browsers are preserved in the client source to retain its hostname pin. A publishable key is client configuration, not a service-role secret. Server secrets and live environment files must stay outside Git.

This is an admin-build baseline. Its server functions use `/admin/_serverFn`. The storefront and login are separately routed runtime releases; building this branch does not establish a replacement for every live route.

The old Phrasly proxy is retired by Nginx HTTP 410 responses. Keep those blocks in place. This commit neither restores the legacy provider-session proxy nor transfers the AWS extension's third-party session behavior.

Backup, restore-rehearsal, isolated build and production-integrity results belong in the Phase 1 verification record after they have been checked.
