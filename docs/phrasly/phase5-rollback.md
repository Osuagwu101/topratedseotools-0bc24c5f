# Phrasly rollback — live Phase 6

The active release runs as PM2 service trst-phrasly-aws-oct26 from /home/ubuntu/releases/trst-phrasly-aws-20261026 on 127.0.0.1:3338.

The effective Nginx file is /etc/nginx/sites-enabled/topratedseotools. The similarly named sites-available file is not the effective routing file. Phase 6 inspected nginx -T and captured the effective file before activation.

## Restore routing

The verified pre-release snapshot is /home/ubuntu/backups/phrasly-phase6-live-20261026/nginx-active.conf (SHA-256 8f6283835c54e51e0edfaa092ebd3d52d54ef943461c2d92744acc5f72f90c53).

1. Copy the snapshot with sudo cp /home/ubuntu/backups/phrasly-phase6-live-20261026/nginx-active.conf /etc/nginx/sites-enabled/topratedseotools.
2. Validate with sudo nginx -t.
3. Only after validation succeeds, reload with sudo systemctl reload nginx.
4. Wait for the new worker configuration to take effect, then verify home/login/admin, StealthWriter, ChatGPT, Turnitin and Turnitin buy pages. The retired /api/phrasly-proxy must remain HTTP 410.
5. If stopping the new backend is necessary, stop only pm2 stop trst-phrasly-aws-oct26 and run pm2 save. Leave the 60 original PM2 services untouched.

The first activation check encountered a request served by an old Nginx worker during graceful reload. The activation script restored the snapshot and reloaded successfully. A retry recorded warmup statuses [404,200], then passed all strict checks. This exercised the routing rollback; it was not a database rollback.

## Data boundary

Do not drop the additive Phrasly tables, delete audit/attempt rows, reset usage, change financial balances or revoke unrelated access. The account owner and explicitly assigned writers have separate feature grants. Revoke a writer through the Phrasly Admin screen when required.

The Phase 5 acceptance matrix restored its temporary settings successfully. Later Phase 6 tests restored only the QA writer's original feature allowances/expiry, retained the intended owner grant, and refreshed the same authorized AWS cookie snapshot encrypted at rest.

The former loopback-only candidate on port 3336 was stopped after the live release passed routing checks. Its package and evidence remain available for inspection; the current protected release directory contains the active settings, extension ZIP, manifest and activation evidence.
