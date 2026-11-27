# ChatGPT attachment reference linking

## Investigation

The proxy logged message-file ownership rejections for the reported writer. The
writer has registered uploads under the same provider identity that is currently
active; the account lookup itself succeeds. Existing diagnostics did not retain
the rejected file ID or the original request payload, so the exact shape of the
customer's failed message cannot be recovered from those logs.

A reproducible defect was found in both authorization and history capture:
`attachment.id ?? attachment.file_id` treats a client-side attachment ID as a
provider file ID. With a UI UUID in `id` and the owned provider file in `file_id`,
the integrated proxy test returned 404 before reaching the provider. Backups also
classified that same valid attachment as unsupported.

## Change

Use a shared, strict provider-ID parser for message authorization, saved-file
references and upload registration. A UI ID no longer hides a valid `file_id`.
Every valid provider reference in the attachment must independently belong to the
writer. Ambiguous upload responses fail closed. Invalid file references prompt
reattachment instead of silently ignoring the attachment. Unmatched references
are logged using a hash, without filenames, file contents or full file IDs.

The upload creation response can use either a valid `file_id` or `id`. Ownership
is still established only from a successful writer-scoped upload response. No
files are assigned to a writer merely because their ID appeared in a message.

## Validation

The integrated durable-history test was changed to include a UI UUID plus an
owned provider `file_id`. It failed with 404 before the change and passed after
it. Tests retain cross-writer denial for both legacy and alternate field shapes,
and reject an owned ID paired with an unowned ID. Existing encrypted backups,
cross-account restoration, generated images, expiry/renewal and private downloads
remain covered. The full OneClick regression suite (31 test programs), typecheck and production
build passed before deployment.

Customer confirmation after a fresh attachment retry is still required to prove
that this defect accounts for their specific failed message; new hashed
diagnostics allow any remaining mismatch to be traced without logging content.
