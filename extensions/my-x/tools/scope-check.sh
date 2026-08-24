#!/bin/sh
# Every content script file shares one global scope. Two files declaring the
# same top-level name is not two names: a duplicate `function` silently
# replaces the earlier one, and a duplicate `const`/`let` throws at load and
# takes that whole file with it. Both have happened here, and both were
# invisible until something downstream broke.
#
# Run from the extension root: sh tools/scope-check.sh
cd "$(dirname "$0")/.." || exit 1

dupes=$(for f in src/*.js src/lib/*.js src/pages/*.js; do
  [ -f "$f" ] || continue
  grep -hoE '^(function|const|let|var) [A-Za-z_$][A-Za-z0-9_$]*' "$f" |
    awk -v F="$f" '{print $2, F}'
done | sort | awk '{ if ($1 == prev) print $1 ": " prevf " and " $2; prev = $1; prevf = $2 }')

if [ -n "$dupes" ]; then
  echo "top-level name declared in more than one file:"
  echo "$dupes"
  exit 1
fi

echo "no top-level name collisions"
