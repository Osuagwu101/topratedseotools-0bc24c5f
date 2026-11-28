# Claude OneClick tool approvals — 28 November 2026

The native client posts `tool_use_id`, `approval_key`, `is_approved` and (for grants) `approval_option` to `/api/organizations/{org}/chat_conversations/{conversation}/tool_approval`. Its error callback displays “Couldn’t send tool approval. You can try again.” OneClick did not allow this endpoint, so authenticated clicks were rejected locally before reaching Claude.

Add only this exact POST endpoint. Require the existing writer session, same-origin request, and conversation ownership in the assigned provider account and organization. Validate the native JSON schema and forward explicit once, per-chat, and deny decisions. Do not reserve new conversation ownership, auto-approve tools, change global permissions, or charge another message quota for an approval. Account-wide `always` grants return an instruction to choose Allow once.

Handler coverage includes allowed decisions, relay body integrity, foreign conversations/organizations, revoked access, assignment changes, malformed requests, and rejected account-wide grants. The full OneClick regression suite and TypeScript checks pass. The earlier recovered document upload failure is a separate incident; this evidence does not establish its cause.
