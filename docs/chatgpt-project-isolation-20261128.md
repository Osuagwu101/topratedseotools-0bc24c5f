# ChatGPT project access — 28 November 2026

The project policy hid only projects already granted to another writer. Unassigned upstream projects therefore passed through the sidebar filters and direct-request checks. Tests explicitly permitted this old behavior. The dedicated ChatGPT hostname was also running an older release independently of the main website.

Project access now defaults to denied. API lists, JSON bootstrap data, streamed SSR project metadata, rendered links and direct requests require a matching writer/project grant in the selected provider account. Successful native project creation records creator access without overwriting another writer's grant. Listing, editing or joining an existing project cannot establish ownership. Account-wide upstream membership alone grants no writer access.

Existing explicit grants remain unchanged. Ordinary conversation ownership and provider-account separation remain enforced. The browser storage marker is versioned to clear stale account sidebar state on the next document load.

Validation: 33 OneClick regression groups, TypeScript and production build pass. Handler tests cover upstream lists, direct project links, cross-account denial, conversation references, creator recording, ownership conflicts and revocation. Pure policy tests cover empty grants, nested metadata, JSON-escaped IDs, bootstrap JSON and streamed server-rendered state.
