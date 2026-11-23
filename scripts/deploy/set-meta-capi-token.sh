#!/usr/bin/env bash
# Save the Meta Conversions API access token into the live app's private .env.
# The token is typed at a hidden prompt: it is never shown, logged or put on a
# command line. Each deploy copies this .env into the new release, so the token
# takes effect on the next deploy (re-run "Deploy to OVH" from GitHub Actions).
#
#   ssh -t ubuntu@<server> "bash /home/ubuntu/deploy/current/scripts/deploy/set-meta-capi-token.sh"
set -euo pipefail
umask 077

ENV_FILE="$(readlink -f /home/ubuntu/deploy/current)/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "The live app settings file was not found. Nothing changed."
  exit 1
fi

printf 'Paste the Meta access token, then press Enter (it will not be shown): '
IFS= read -rs TOKEN
echo
if [[ ! "$TOKEN" =~ ^[A-Za-z0-9_-]{40,1024}$ ]]; then
  echo "That does not look like a Meta access token. Nothing changed."
  exit 1
fi

tmp="$(mktemp "$(dirname "$ENV_FILE")/.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
grep -v '^META_CAPI_ACCESS_TOKEN=' "$ENV_FILE" > "$tmp" || true
printf 'META_CAPI_ACCESS_TOKEN=%s\n' "$TOKEN" >> "$tmp"
chmod --reference="$ENV_FILE" "$tmp"
chown --reference="$ENV_FILE" "$tmp" 2>/dev/null || true
mv "$tmp" "$ENV_FILE"
trap - EXIT
unset TOKEN
echo "Saved. It takes effect on the next deploy."
