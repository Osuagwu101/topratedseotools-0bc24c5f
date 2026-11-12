TopRated Claude Native Pilot 0.1.0 — Super Admin only

1. Use a separate Chrome test profile. Sign in to Topratedseotools.com as Super Admin.
2. Extract this ZIP. Open chrome://extensions and enable Developer mode.
3. Choose Load unpacked and select the extracted folder containing manifest.json.
4. Refresh https://topratedseotools.com/admin/tools/claude and select Authorised session.
5. Click Test native Claude in Chrome. Complete any normal Claude verification yourself.
6. Confirm whether you reach the signed-in editor, can send a message and reopen it.

The extension imports the stored sessionKey into this Chrome profile and opens the
real https://claude.ai/new website. It does not solve or bypass browser challenges.
It refuses to replace a different existing Claude session. If the same session is
already present, the page reports that it reused the existing login; that is not
proof of a fresh cookie import.

This pilot DOES NOT isolate chats on a shared Claude account. It is unavailable to
writers. Native-session cookies are present in the test browser and can be accessed
by its owner. Uninstalling an extension does not delete site cookies: when finished,
remove the Claude cookies in Chrome settings or delete the disposable profile.
Do not use Claude's Log out button if this is a shared session you need to retain.
No official Claude API is used. Other TopRated tools/extensions are unchanged.
