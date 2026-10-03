# TopRatedSEOtools ChatGPT Session Checker

Admin-only Chrome extension for checking the structure of the current signed-in ChatGPT browser state.

## What it does

- Reads cookie metadata for `chatgpt.com` through Chrome's extension API.
- Checks whether the NextAuth session token is present as either:
  - one unchunked `__Secure-next-auth.session-token`, or
  - a complete contiguous `.0, .1, ...` chunk sequence.
- Shows which approved supporting cookie names are present.
- Opens the ChatGPT Admin page in one click.

## What it deliberately does not do

- It does not display cookie values.
- It does not write cookie values to disk.
- It does not transmit cookie values anywhere.
- It does not sync or replay authentication credentials.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `ops/chatgpt-admin-extension` folder.
5. Sign in to ChatGPT normally in the same Chrome profile.
6. Click the extension icon and choose **Check again**.

This extension is intended only for the TopRatedSEOtools Admin's own browser.


## Version 0.2

Version 0.2 can observe the cookie **names only** attached to matching ChatGPT `user`, `me`, and `init` requests through Chrome's webRequest API.

It still never records, displays, stores, or transmits cookie values.


## Version 0.3

Version 0.3 adds the manual Admin replacement workflow:

1. Click **Observe now** while signed in to ChatGPT.
2. The extension reloads ChatGPT and records only approved cookie names attached to matching `user`, `me`, and `init` requests.
3. Click **Check again** to build:
   - the core session-token set,
   - supporting names observed on all captured targets,
   - additional approved names observed on some targets.
4. Click **Configure Admin**.
5. The Admin page opens on the Authorised session tab with fields generated from those names.
6. Paste the matching values manually into the Admin fields.
7. Click **Approve & Replace Session**.

The extension never displays, stores, or transmits cookie values.
