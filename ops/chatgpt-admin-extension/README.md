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
