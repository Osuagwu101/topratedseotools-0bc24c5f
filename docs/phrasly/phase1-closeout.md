# Phrasly Phase 1 closeout

**Complete on 25 October 2026.** The earlier connection blocker is resolved. This closes preparation of the TopRatedSEOTools.com baseline, backup and recovery checks. It does not enable Phrasly processing.

## Verified results

| Gate | Result |
| --- | --- |
| Dedicated branch | `phrasly/phase1-baseline-20261025`; original main/admin refs unchanged |
| Deployed source preserved | Eight deployed differences captured in `f3dbde3fab0994f999e9e2a0e464128dba79075f` |
| Current source parity | **384/384** build inputs match the branch; zero missing, changed or extra source files |
| Inventory | [384 files with paths, hashes, sizes, owners and modes](phase1-source-inventory.json); all owned by ubuntu:ubuntu |
| Compile | **PASS**, [run 40192768445](https://github.com/Osuagwu101/topratedseotools-0bc24c5f/actions/runs/40192768445), dummy configuration and frozen Bun lock |
| Backup restoration | **PASS**, five archives, 5,721 regular files and two symlinks |
| Ownership | **PASS**, all 5,826 archive members match source UID/GID |
| Runtime smoke checks | **3/3 PASS**, original releases hidden and external networking unavailable |
| Public endpoint checks | **6/6 PASS**, expected 200/410 responses retained |
| Production integrity | **PASS**, 5,826 filesystem entries and 60 PM2 process records unchanged |
| Nginx syntax | **PASS** |
| Phrasly settings / stored sessions / proxy sessions | **0 / 0 / 0**, unchanged by read-only checks |
| Temporary test processes | **Stopped**; no test Node or Nginx processes remaining |

The final host comparison was at 15:28:17 UTC (16:28:17 WAT); the final database count was at 15:29:01 UTC. The [machine-readable evidence](phase1-verification.json) and [routing/build baseline](phase1-baseline.md) contain the details.

## Protected recovery point

`/home/ubuntu/backups/phrasly-phase1-20261025T151022Z`

The containing directory is mode 0700; archives are mode 0600. Files containing live configuration remain on the original VPS. No backup archive, environment file, session, customer record or private key was pushed to GitHub.

| Archive | Regular files | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| storefront-runtime.tar.gz | 1279 | 5217454 | `ac7f83c700b982e9d65faf79826eb78dd857a54cf950d3517a316798da9e1165` |
| login-runtime.tar.gz | 1004 | 3153408 | `fbefc3bcf4e90c779f910f59fd834ffc85faeece67b7197d2c2f70eff0969c98` |
| admin-runtime-source.tar.gz | 1037 | 3223106 | `ab22fc1ec7526dab35e290b9820a33593d803149db945fdbf9b6b1a7c127840e` |
| assets.tar.gz | 2344 | 9208835 | `d1e0160e92c9b8b2bb8a493558e9bd45822bc2a48cb54f5766e8fd8782342587` |
| nginx-configuration.tar.gz | 57 | 11959 | `ea6386260be8f68266098a455cc4d5fce9024e77462d95a92765accff90069e6` |

Host-local evidence includes per-file manifests, whitelisted PM2/runtime arguments, integrity comparisons, archive checksums, ownership checks and namespace rehearsal results. [Rollback instructions](phase1-rollback.md) explain how to verify the existing recovery point and prepare a later authorized recovery without overwriting live releases.

## What the isolated rehearsal proved

Each restored public, login and admin runtime loaded its declared tslib 2.8.1 dependency and started from a copied compiled artifact. The original `/home/ubuntu/releases` directory was hidden only inside the test mount namespace. The test network namespace had only loopback and no default route.

A temporary Nginx instance served an asset with the same SHA-256 as the restored artifact and returned 410 for both retired Phrasly endpoints. A direct first-party method-denial request to each Node runtime returned 405 without processing a provider request. All temporary processes were stopped.

An initial probe requested an asset directly from the Node SSR service and timed out. The corrected rehearsal models the production boundary where Nginx serves shared static assets; it tests the Node method gate separately. That adjustment changed only the isolated test.

The test used dummy Supabase configuration and loaded no production environment file. It did not test authenticated HTML/data flows, real accounts, TLS, provider processing, or a production route switch. Those remain later-phase validation work.

Runtime versions read from the VPS: Node 22.23.2, npm 10.9.8, Nginx 1.24.0 (Ubuntu), PM2 7.0.4 and Python 3.12.3.

## Scope retained for the next phase

The existing npm lock remains stale. Reproducible compilation uses the unchanged `bun.lock` and Bun 1.4.4; no dependency upgrade was introduced. The public release is bundle-only, so this branch is not asserted to be its exact source counterpart. Preserve the separate public/login/admin route map.

No production application, Nginx routing, financial data or customer configuration was changed. No existing service was restarted or reloaded. Phase 2—the authorized Phrasly integration decision—has not started.
