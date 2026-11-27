# Postpaid checkout recovery

An abandoned website checkout previously remained pending in the local settlement
ledger indefinitely. A later, separately confirmed offline payment did not change
that checkout. The next PAY NOW attempt rejected the customer without checking the
gateway again, and the compact payment panel did not expose reconciliation.

Checkout initialization now verifies an existing pending checkout using its original
provider and matching environment. Verified failures are conditionally marked failed
before replacement. Successful payments pass existing amount, currency and owner
metadata validation and are finalized; the customer refreshes before paying again.
Genuinely pending transactions, gateway outages, mismatched references/environments,
and concurrent status changes do not permit replacement. Database uniqueness still
prevents multiple pending website checkouts.

The compact payment panel now provides Retry payment verification and displays its
result, including in the blocked submission dialog. No account billing modes,
confirmed receipts, balances, rates or thresholds are altered by this change.

Validation: `node --test tests/turnitin-postpaid-checkout-recovery.test.ts`;
existing postpaid regression suites and production build before deployment.
