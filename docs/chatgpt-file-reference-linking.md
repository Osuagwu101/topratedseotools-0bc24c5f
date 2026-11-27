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

## Deployment handoff (27 November 2026)

PR #223 is merged. Code commit 8afa9e23da36fdb8e051039eddbfc4d8da5fa25b passed
GitHub Production Build run 46011954171. Main-site deployment run 46012136101
succeeded and published /home/ubuntu/releases/trst-main-8afa9e2 on port 3271.
The installed main deployment runner did not emit a dedicated ChatGPT update.
The last verified ChatGPT vhost still targeted port 3332 from release
trst-main-fd25693. Do not report this fix live on that host until it is verified.

Remote Desktop Commander stopped responding while checking the dedicated host.
Two read-only calls timed out/were pending. After the authorized laptop reconnects,
first verify the current vhost and process release. If still old, use the existing
blue/green deploy_chatgpt_process function from the newly built release's
scripts/deploy/ovh_deploy_main.py, preserving the running ChatGPT environment.
The function checks the candidate for the expected anonymous 401 response before
switching the ChatGPT vhost and retains the old process for rollback. Confirm its
CHATGPT_OK output, nginx target, process cwd/commit and public 401 health afterward.
Then ask the customer to remove the failed attachment and upload it again.

No customer files, balances, upstream sessions or ownership rows were changed.
