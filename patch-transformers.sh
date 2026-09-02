#!/bin/sh
# Patches the vendored transformers.min.js so it never loads onnxruntime through
# a blob: URL. Run once per extension after replacing the bundle:
#
#   sh patch-transformers.sh
#
# WHY. onnxruntime is loaded by wrapping its factory .mjs in a Blob and calling
# `import(blob:...)`. MV3's extension_pages CSP is `script-src 'self'` and Chrome
# REFUSES to accept blob: there — "Insecure CSP value" and the extension will not
# load at all, so the policy cannot simply be widened. The import is therefore
# blocked and both backends fail with:
#
#   no available backend found. ERR: [webgpu] TypeError: Failed to fetch
#   dynamically imported module: blob:chrome-extension://<id>/<uuid>
#
# Measured: with blob: allowed the identical setup loads in 8s; without it, it
# fails every time. Nothing else changes that — not wasmPaths, not the timeout,
# not transformers' own IS_CHROME_AVAILABLE flag. So the two places that reach
# for a blob are turned off here, leaving the direct same-origin import that
# `script-src 'self'` does allow.
#
# markdown-reader never needed this: a webview CSP may contain blob:, and its
# does. This is the one part of that setup a Chrome extension cannot copy.
set -e
cd "$(dirname "$0")"

# 1. transformers: fetches the factory, rewrites one line, blobs it. The guard is
#    already there for extensions — it just cannot detect one from inside a
#    worker, where `chrome` is not exposed. Forced on.
FROM_1='ie.IS_SERVICE_WORKER_ENV||ie.IS_CHROME_AVAILABLE'
TO_1='!0'

# 2. onnxruntime: blobs the factory whenever it judges it cross-origin. It always
#    does for us — `new URL("chrome-extension://...").origin` is the string "null"
#    because the scheme is not "special", so our own file never matches our own
#    page. Forced off.
FROM_2='i=r&&a&&!pc(a,e)'
TO_2='i=!1'

for ext in epub-reader pdf-reader reading-mode; do
  f="extensions/$ext/lib/transformers/transformers.min.js"
  [ -f "$f" ] || { echo "  skip  $f (not present)"; continue; }
  if ! grep -qF "$FROM_1" "$f" && ! grep -qF "$FROM_2" "$f"; then
    echo "  have  $ext (already patched)"
    continue
  fi
  python3 - "$f" "$FROM_1" "$TO_1" "$FROM_2" "$TO_2" <<'PY'
import sys, pathlib
path, f1, t1, f2, t2 = sys.argv[1:6]
p = pathlib.Path(path); s = p.read_text()
for frm, to in ((f1, t1), (f2, t2)):
    n = s.count(frm)
    if n == 0:
        continue
    if n != 1:
        sys.exit(f"expected 1 occurrence of {frm!r} in {path}, found {n} — bundle changed, re-derive the patch")
    s = s.replace(frm, to, 1)
p.write_text(s)
PY
  echo "  patch $ext"
done

echo
echo "done. Verify with: grep -c 'i=!1' extensions/*/lib/transformers/transformers.min.js"
