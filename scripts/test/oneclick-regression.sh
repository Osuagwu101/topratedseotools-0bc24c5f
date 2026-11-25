#!/usr/bin/env bash
# Runs EVERY Claude and ChatGPT OneClick test, so a fix for one feature
# cannot silently break a feature that was fixed before. New test files named
# tests/claude-*.test.ts or tests/chatgpt-*.test.ts are picked up automatically.
set -u
fail=0
for t in tests/claude-*.test.ts tests/chatgpt-*.test.ts; do
  if grep -qE '^test\(|from "bun:test"' "$t"; then
    bun test "$t" >/tmp/oneclick-test.log 2>&1
  else
    bun "$t" >/tmp/oneclick-test.log 2>&1
  fi
  if [ $? -eq 0 ]; then echo "PASS $t"; else echo "FAIL $t"; tail -20 /tmp/oneclick-test.log; fail=1; fi
done
if node --test --experimental-strip-types scripts/claude-browser-transport/*.test.mjs scripts/claude-voice/*.test.mjs >/tmp/oneclick-test.log 2>&1; then
  echo "PASS Claude relay and voice bridge"
else
  echo "FAIL Claude relay and voice bridge"; tail -30 /tmp/oneclick-test.log; fail=1
fi
exit $fail
