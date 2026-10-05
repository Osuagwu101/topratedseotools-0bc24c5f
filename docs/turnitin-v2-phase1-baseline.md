# Turnitin V2 — Phase 1 Baseline & Architecture

Status: **Phase 1 / no runtime behavior changes**

This document freezes the currently working Turnitin system and defines the architecture for the agreed Turnitin restructuring. It is the implementation contract for Phases 2–6.

## 1. Rollback baseline

- Git baseline: `main` at commit `7ef0d41`.
- Git backup branch: `backup/turnitin-v2-pre-restructure-20261005`.
- Current production upstream: `127.0.0.1:3017`.
- Current PM2 process: `topratedseotools-turnitin-direct-downloads`.
- Current release: `/home/ubuntu/releases/topratedseotools-turnitin-direct-downloads-20261005`.
- VPS rollback archive: `/home/ubuntu/backups/turnitin-v2-pre-restructure-20261005.tar.gz`.
- Nginx config and PM2 metadata are included in the VPS rollback archive.
- Protected runtime secrets/session values are deliberately not copied into Git or Phase 1 documentation.

Phase 1 does not change Nginx, PM2, Supabase schema, payment logic, Originality integration, or customer behavior.

## 2. Current Turnitin production model

Current customer route:

- `/tools/turnitin`
- Turnitin is rendered as a special case inside the generic `/tools/$slug` tool page.
- The current workspace already contains credit balance, purchase flow, upload/submission controls, history, results, and report downloads.
- The Originality Reports adapter, authorised-session vault, private source/report storage, result sync, and report downloads are already working and must be preserved.

Current main navigation:

- Tools
- Pricing
- About
- Contact

Turnitin is therefore discoverable as a tool, but is not yet a first-class product area in the site navigation.

## 3. Current database baseline

The existing production Turnitin schema contains six isolated Turnitin tables:

1. `turnitin_credit_purchases`
2. `turnitin_credit_batches`
3. `turnitin_credit_ledger`
4. `turnitin_jobs`
5. `turnitin_reports`
6. `turnitin_originality_authorized_session`

Existing credit functions:

- `turnitin_expire_user_credits`
- `turnitin_grant_paid_purchase`
- `turnitin_reserve_credit`
- `turnitin_consume_reserved_credit`
- `turnitin_release_reserved_credit`
- `turnitin_refund_consumed_credit`
- `turnitin_finalize_credit_purchase`
- `turnitin_my_credit_summary`

Private storage buckets:

- `turnitin-source`
- `turnitin-reports`

Both remain private with the existing 100 MB limit.

The current production baseline has very little live Turnitin history, so all future migrations must preserve every existing row and must be additive/idempotent.

## 4. Non-negotiable isolation rules

The Turnitin V2 work must not alter the behavior of:

- StealthWriter
- Phrasly
- ChatGPT
- ordinary tool subscriptions
- normal `tool_orders`
- normal `tool_payments`
- existing subscription checkout
- Admin authentication
- Originality Reports session vault
- Originality upload/status/report adapter
- existing completed Turnitin jobs/reports

The Browse Tools Turnitin card may remain for discovery, but it will eventually redirect into the dedicated Turnitin product area.

## 5. Target customer navigation

Phase 2 will promote Turnitin to a first-class navigation item:

`Tools | Turnitin Checks | Pricing | About | Contact`

Dedicated customer routes:

- `/turnitin` — Overview
- `/turnitin/submit` — Submit File
- `/turnitin/buy` — Buy Checks for prepaid accounts
- `/turnitin/history` — Check History

Compatibility route:

- `/tools/turnitin` should redirect to `/turnitin` once the dedicated area is ready.

For Postpaid customers, the third section should present settlement/outstanding-balance actions rather than forcing credit purchases. The route may remain stable while its label/content adapts by account type.

## 6. Submit File page contract

The dedicated Submit File page will contain all submission-only controls and information:

- PDF, DOC and DOCX upload
- 100 MB maximum
- AI-detection requirements
  - at least 300 words of prose/long-form writing
  - no more than 30,000 words
  - supported languages shown from the current verified requirements
- report title
- author first name
- author last name
- defaults:
  - first name: `Top Rated`
  - last name: `Writing Services`
- users may edit either name
- exact submitted author values must continue to be sent to Originality Reports and therefore appear in the generated Originality report metadata
- similarity options:
  - Exclude Bibliography
  - Exclude Quotes
  - Exclude Cited Text
  - Exclude Small Matches
  - small-match mode/threshold
- one document per job
- one accepted prepaid job consumes one credit
- postpaid jobs follow the postpaid charge rules below

The existing working Originality adapter is reused; it is not redesigned.

## 7. Prepaid account model

A normal Turnitin customer remains a **Prepaid Account**.

Rules:

- buy credits before checking
- standard public price remains ₦2,300/check
- one accepted document = one credit
- purchase batches retain independent expiry
- normal purchase credits expire seven days after verified payment
- oldest-expiring valid credits are used first
- full upstream failure follows the existing refund behavior

### Manual Admin credit grants

Phase 3 will add a dedicated Admin grant flow.

Admin can:

- choose customer
- choose quantity
- choose expiry, defaulting to 7 days
- add required reason/note
- grant without creating a fake subscription/payment

Implementation must use the existing Turnitin credit batch/ledger model, not `tool_orders`.

Audit requirements:

- who granted the credits
- how many
- grant time
- expiry
- reason/note
- immutable ledger entry

A manual grant must never silently overwrite the customer's balance.

## 8. Postpaid account model

Postpaid is a separate Turnitin billing mode, not an unlimited/free account.

### Permission rules

The existing `user_roles.is_super_admin` capability is the authority boundary.

- **Only Super Admin** can enable or disable Postpaid status for a customer.
- Once Postpaid is enabled, Admin/Super Admin may maintain the agreed per-check rate and record settlements.
- Every status/rate change must be audited.

### Negotiated rate

Each Postpaid customer has an agreed amount per check.

Examples:

- User A: ₦2,000/check
- User B: ₦1,800/check
- User C: ₦2,300/check

The agreed rate is not the public prepaid price and must never change the public ₦2,300 prepaid price.

### Rate snapshot invariant

The active agreed rate must be copied onto each charge at the time that job becomes billable.

Example:

- old rate = ₦2,000
- 5 old checks remain ₦2,000 each forever
- Admin later changes rate to ₦2,200
- only newly billable checks use ₦2,200

Historical charges must never be recalculated from the customer's latest rate.

### Submission/billing behavior

Postpaid customers:

- can submit with zero prepaid credits
- do not reserve/consume prepaid credits
- still use the exact same Originality submission engine
- receive the same results/reports/history

A postpaid charge should be created when Originality has accepted the submission, mirroring the current point where a prepaid credit becomes consumed.

If an accepted job later results in a complete unusable failure that would qualify a prepaid customer for a refund, the corresponding Postpaid charge must be voided rather than left payable.

## 9. Proposed Postpaid data model

Exact migration names may change during implementation, but responsibilities are fixed.

### `turnitin_account_settings`

One row per Turnitin customer.

Key responsibilities:

- `user_id`
- billing mode: `prepaid` or `postpaid`
- current negotiated Postpaid rate
- Postpaid enabled/disabled timestamps
- enabled/disabled by Super Admin
- current status
- audit timestamps

### `turnitin_postpaid_rate_history`

Immutable rate-change history.

Tracks:

- user
- previous rate
- new rate
- effective timestamp
- Admin who changed it
- required reason/note

### `turnitin_postpaid_charges`

One billable charge per accepted Postpaid Turnitin job.

Tracks:

- user
- job
- snapshotted rate
- amount
- charge status: unpaid / partially paid / paid / void
- charged timestamp
- void reason when applicable

A job may create at most one Postpaid charge.

### `turnitin_postpaid_settlements`

Records money received against a Postpaid account.

Tracks:

- user
- amount
- payment method
- website/offline/WhatsApp/bank/other source
- gateway/reference where applicable
- received timestamp
- Admin recorder where manually recorded
- note

### `turnitin_postpaid_allocations`

Allocates settlement money to individual charges.

This permits:

- partial settlement
- full settlement
- permanent transaction history
- accurate remaining balance
- no destructive "clear balance" operation

Oldest unpaid charges should be the default allocation order unless Admin explicitly selects charges.

## 10. Postpaid balance rules

For a Postpaid account:

`Outstanding = sum(active charge amounts) - sum(valid settlement allocations)`

Dashboard examples:

- Rate per check: ₦2,000
- Unpaid checks: 7
- Total accrued: ₦14,000
- Paid: ₦10,000
- Outstanding: ₦4,000

No balance is erased when settled. Charges and settlements remain permanently auditable.

## 11. Target Admin experience

Customer Admin page will eventually gain a dedicated Turnitin section rather than forcing Turnitin into the normal subscription assignment dialog.

### Prepaid customer controls

- available credits
- reserved credits
- next expiry
- manual grant credits
- grant history
- check history

### Postpaid customer controls

- Postpaid badge/status
- current negotiated rate
- rate history
- unpaid checks
- accrued amount
- paid amount
- outstanding amount
- record partial/full settlement
- settlement history
- check/charge history

### Super Admin-only controls

- enable Postpaid
- disable Postpaid
- convert back to Prepaid after outstanding balance rules are satisfied
- exceptional Postpaid status override only with an audit reason

## 12. Account conversion safeguards

Prepaid → Postpaid:

- existing prepaid credits are not deleted
- they remain recorded and may remain available if the account later returns to prepaid
- Postpaid submissions do not consume them while Postpaid is active

Postpaid → Prepaid:

- must not silently erase outstanding charges
- default rule: block conversion while outstanding balance > ₦0
- any Super Admin exceptional override must require a reason and retain all audit records

## 13. Payment separation

Prepaid:

- existing dedicated Turnitin credit purchase flow
- public rate ₦2,300/check

Postpaid:

- negotiated rate per account
- online settlement may use the existing active gateway through a dedicated Postpaid settlement flow
- offline/bank/WhatsApp settlements may be manually recorded by Admin
- no Postpaid settlement should create a normal tool subscription

## 14. Phase boundaries

### Phase 1 — Backup & architecture baseline

- completed rollback snapshot
- current schema/route map
- frozen V2 architecture
- no behavior changes

### Phase 2 — Dedicated Turnitin navigation/workspace

- main-menu Turnitin Checks
- dedicated Overview / Submit File / Buy Checks / History routes
- Browse Tools compatibility redirect
- preserve working backend

### Phase 3 — Manual credit management

- Admin grant UI
- server-only grant function
- expiry/note/audit trail
- no subscription coupling

### Phase 4 — Postpaid account engine

- account billing mode
- Super Admin-only Postpaid enable/disable
- agreed per-check rate
- immutable rate history
- job charge creation/void logic

### Phase 5 — Postpaid Admin billing & settlements

- charge/outstanding dashboards
- partial/full settlements
- website and offline settlement support
- allocations and permanent history

### Phase 6 — Integration & controlled cutover

- end-to-end prepaid regression
- end-to-end Postpaid regression
- manual-credit regression
- rate-change snapshot regression
- partial/full settlement regression
- Turnitin report/upload regression
- StealthWriter/Phrasly/ChatGPT/payment regressions
- rollback-safe production cutover

## 15. Phase 1 acceptance criteria

Phase 1 is complete only when:

- current Git state is backed up
- current production release/Nginx/PM2 state is backed up
- current Turnitin database structure is mapped
- existing Super Admin capability is confirmed
- target routes/account models/data responsibilities are frozen
- no live behavior, data, payment, navigation, or Originality integration has changed
