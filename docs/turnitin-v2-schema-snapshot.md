# Turnitin V2 — Production Schema Snapshot

Snapshot date: 2026-10-05  
Purpose: Phase 1 read-only baseline before Turnitin V2 restructuring.

No secrets, user identifiers, document contents, payment references, or session payloads are included here.

## Production row counts

- `turnitin_credit_purchases`: 1
- `turnitin_credit_batches`: 1
- `turnitin_credit_ledger`: 5
- `turnitin_jobs`: 2
- `turnitin_reports`: 2
- `turnitin_originality_authorized_session`: 1

These counts are informational only. Future migrations must preserve all rows regardless of count.

## Tables

### turnitin_credit_purchases

Purpose: isolated one-time Turnitin prepaid purchases.

Key fields:

- id
- user_id
- quantity
- unit_amount_ngn
- total_amount_ngn
- status
- payment_gateway
- payment_reference
- paid_at
- expires_at
- payment_currency
- payment_amount
- gateway_environment
- gateway_reference
- gateway_transaction_id
- initiated_at
- verified_at
- last_error
- metadata
- created_at / updated_at

Important index guarantees:

- unique gateway + payment reference when present
- user + created_at lookup
- payment-reference lookup

### turnitin_credit_batches

Purpose: independent prepaid/refund/admin credit batches.

Key fields:

- id
- user_id
- source
- purchase_id
- source_job_id
- granted_credits
- available_credits
- reserved_credits
- consumed_credits
- expired_credits
- refunded_credits
- expires_at
- note
- created_at / updated_at

Important index guarantees:

- one batch per purchase
- one refund batch per refunded job
- spend lookup by user + expiry

### turnitin_credit_ledger

Purpose: immutable audit trail of credit movements.

Key fields:

- id
- user_id
- batch_id
- purchase_id
- job_id
- event_type
- available_delta
- reserved_delta
- consumed_delta
- expired_delta
- refunded_delta
- idempotency_key
- note
- created_at

Important index guarantees:

- unique idempotency key when present
- job history lookup
- user ledger lookup

### turnitin_jobs

Purpose: document/check lifecycle and Originality submission state.

Key fields:

- id
- user_id
- original_filename
- display_name
- mime_type
- file_size_bytes
- source_storage_bucket
- source_storage_path
- status
- upstream_status
- upstream_submission_id
- upstream_upload_token
- upstream_last_checked_at
- upstream_sync_attempts
- upstream_last_error
- exclude_bibliography
- exclude_quotes
- exclude_citations
- exclude_small_matches
- small_match_mode
- small_match_threshold
- report_view
- report_format
- report_title
- author_first_name
- author_last_name
- word_count
- similarity_percentage
- ai_percentage
- ai_unavailable_reason
- credit_state
- reserved_credit_batch_id
- reservation_version
- reserved_at
- consumed_at
- refunded_at
- submitted_at
- accepted_at
- completed_at
- failed_at
- failure_code
- failure_message
- created_at / updated_at

Important index guarantees:

- unique upstream submission id when present
- unique upload token when present
- user + status + created_at lookup
- user + filename lookup
- user + created_at lookup

### turnitin_reports

Purpose: private similarity/AI report metadata.

Key fields:

- id
- user_id
- job_id
- report_type
- status
- score
- storage_bucket
- storage_path
- mime_type
- file_size_bytes
- sha256
- unavailable_reason
- available_at
- created_at / updated_at

Important index guarantees:

- unique job + report type
- user + created_at lookup

### turnitin_originality_authorized_session

Purpose: encrypted server-side authorised Originality Reports session.

Key fields:

- id
- encrypted_payload
- session_format
- status
- updated_by
- created_at / updated_at

The encrypted payload is deliberately excluded from this snapshot.

## Existing database functions

- `turnitin_expire_user_credits(user_id)`
- `turnitin_grant_paid_purchase(purchase_id)`
- `turnitin_reserve_credit(user_id, job_id)`
- `turnitin_consume_reserved_credit(user_id, job_id, upstream_submission_id)`
- `turnitin_release_reserved_credit(user_id, job_id, reason)`
- `turnitin_refund_consumed_credit(user_id, job_id, reason)`
- `turnitin_finalize_credit_purchase(purchase_id, reference, gateway_transaction_id, paid_at)`
- `turnitin_my_credit_summary()`

Future phases must extend these responsibilities rather than replacing the proven credit/job adapter without a specific migration reason.

## RLS baseline

Customer-facing Turnitin tables currently use owner/admin read policies:

- credit purchases
- credit batches
- credit ledger
- jobs
- reports

Authenticated users may read their own rows. Admin role may read through the existing role helper.

Mutations remain server-side/service-role controlled.

The authorised Originality session remains server-only and is not a customer-readable resource.

## Storage baseline

Private buckets:

### turnitin-source

- public: false
- file-size limit: 100 MB
- used for source documents during submission lifecycle

### turnitin-reports

- public: false
- file-size limit: 100 MB
- used for similarity and AI PDFs

## Authorization baseline

Existing authorization already includes:

- `user_roles.role`
- `user_roles.is_active`
- `user_roles.is_super_admin`

Turnitin V2 Postpaid enable/disable must use the existing `is_super_admin` boundary. It must not create a parallel global super-admin system.

## Migration rule for Phases 2–6

Every migration must be:

- additive where possible
- idempotent
- non-destructive to existing Turnitin rows
- isolated from ordinary subscription/order/payment tables
- compatible with the existing Originality adapter
- accompanied by regression coverage
