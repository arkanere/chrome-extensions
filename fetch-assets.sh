#!/bin/sh
# Downloads the Kokoro read-aloud assets that are too big for git: the model, its
# voices, and onnxruntime's WebAssembly. They are fetched ONCE into .assets-cache
# and then hardlinked into each of the three readers.
#
#   sh fetch-assets.sh
#
# Hardlinks are what let this respect the repo's self-containment rule without
# paying for it three times. Chrome packs the folder you point it at, so each
# extension must hold real files — and a hardlink is a real file, just one that
# shares its bytes with the cache. Three copies of 326MB would be a gigabyte;
# this is 365MB. If the link cannot be made (cache and repo on different
# filesystems) the file is copied instead, and everything still works.
#
# Total: ~365 MB. Safe to re-run — anything already in place is skipped.
set -e
cd "$(dirname "$0")"

CACHE=".assets-cache"
EXTENSIONS="epub-reader pdf-reader reading-mode"

MODEL_REPO="onnx-community/Kokoro-82M-v1.0-ONNX-timestamped"
HF="https://huggingface.co/$MODEL_REPO/resolve/main"

# onnxruntime-web, pinned to the version bundled inside transformers.min.js
# (its env.versions.web). A mismatch here is a runtime failure, not a warning.
ORT_VERSION="1.25.0-dev.20260327-722743c0e2"
ORT_CDN="https://cdn.jsdelivr.net/npm/onnxruntime-web@$ORT_VERSION/dist"

# fp32 is not a default worth changing: q8 measured six times SLOWER on WebGPU,
# because quantised weights need dequantisation work the GPU handles badly.
MODEL_FILE="onnx/model.onnx"

# The wasm fallback needs its own weights, and this is not optional: when WebGPU
# is unavailable HeadTTS retries on wasm, transformers asks for the quantised
# build by name, and without this file that is a 404 — which, with remote models
# disabled, throws. The whole voice then fails over to chrome.tts for want of an
# 88MB file. q8 (model_quantized.onnx) rather than q4: q4 is 291MB, nearly as
# large as fp32, and q8 is transformers' own default dtype for the wasm device.
MODEL_FILE_WASM="onnx/model_quantized.onnx"

# The voices offered in the picker. Each is ~0.5 MB; add a name here and in
# speech/kokoro-adapter.js and it appears automatically.
VOICES="af_heart af_bella af_nicole af_sarah am_michael am_fenrir am_puck bf_emma bm_george"

get() { # url, path relative to the cache root
  dest="$CACHE/$2"
  if [ -s "$dest" ]; then echo "  have  $2"; return; fi
  mkdir -p "$(dirname "$dest")"
  echo "  get   $2"
  curl -# -fL --retry 3 --max-time 1800 "$1" -o "$dest.part"
  mv "$dest.part" "$dest"
}

place() { # path relative to both the cache root and each extension root
  for ext in $EXTENSIONS; do
    dest="extensions/$ext/$1"
    [ -s "$dest" ] && continue
    mkdir -p "$(dirname "$dest")"
    ln "$CACHE/$1" "$dest" 2>/dev/null || cp "$CACHE/$1" "$dest"
  done
}

# Small files first, so a broken path surfaces in a second rather than after the
# 326MB one has been read.
echo "Kokoro model -> $CACHE/models/$MODEL_REPO"
for f in config.json tokenizer.json tokenizer_config.json "$MODEL_FILE" "$MODEL_FILE_WASM"; do
  get "$HF/$f" "models/$MODEL_REPO/$f"
done

echo "voices -> $CACHE/voices"
for v in $VOICES; do
  get "$HF/voices/$v.bin" "voices/$v.bin"
done

echo "onnxruntime $ORT_VERSION -> $CACHE/lib/ort"
for f in ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm \
         ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  get "$ORT_CDN/$f" "lib/ort/$f"
done

echo
echo "linking into: $EXTENSIONS"
for f in config.json tokenizer.json tokenizer_config.json "$MODEL_FILE" "$MODEL_FILE_WASM"; do
  place "models/$MODEL_REPO/$f"
done
for v in $VOICES; do place "voices/$v.bin"; done
for f in ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm \
         ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  place "lib/ort/$f"
done

echo
echo "done: $(du -sh "$CACHE" | awk '{print $1}') cached, shared by three extensions"
