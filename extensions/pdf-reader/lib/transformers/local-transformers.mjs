// lib/transformers/local-transformers.mjs — transformers.js, pinned to disk.
//
// HeadTTS's worker imports transformers.js from whatever URL it is given and
// then calls `from_pretrained(settings.model)`. Left alone, that reaches out to
// huggingface.co for the weights and to a CDN for onnxruntime's WebAssembly —
// which MV3 would block anyway, and which would make reading a book aloud
// depend on the network.
//
// transformers.js keeps its configuration in a single shared `env` object, so
// re-exporting the library from a module that sets those fields first is enough
// to redirect it. Nothing in HeadTTS is patched.
//
// The values below arrive as query parameters rather than being written here,
// because an extension's origin contains its id and that is not known until
// Chrome installs the folder. speech/kokoro-adapter builds them with
// chrome.runtime.getURL and appends them to this module's own URL.

import * as transformers from "./transformers.min.js";

const params = new URL(import.meta.url).searchParams;
const modelRoot = params.get("models");
const ortMjs = params.get("ortmjs");
const ortWasm = params.get("ortwasm");

const { env } = transformers;

if (modelRoot) {
  // from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX-timestamped") becomes
  // a lookup under <modelRoot>/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/.
  //
  // A chrome-extension:// URL works here where an https one would not:
  // getFileMetadata takes its local branch only `if (env.allowLocalModels &&
  // !isValidUrl(path, ["http:", "https:"]))`, so an https localModelPath is
  // classified as remote, the local branch is skipped, and the failure surfaces
  // as "Cannot read properties of undefined (reading 'tokenizer_class')".
  env.allowLocalModels = true;
  env.localModelPath = modelRoot.endsWith("/") ? modelRoot : modelRoot + "/";
  // Belt and braces: if a file is missing, fail here rather than quietly
  // downloading 326MB from Hugging Face on someone's tethered connection.
  env.allowRemoteModels = false;
  // The files are already on disk inside the extension. Letting transformers.js
  // cache them would put a second 326MB copy in the browser's profile.
  env.useBrowserCache = false;
}

if (ortMjs && ortWasm) {
  // Chromium takes the asyncify build. onnxruntime *imports* the .mjs rather
  // than fetching it, which is why it has to be named explicitly here: an import
  // cannot be intercepted the way a fetch can.
  //
  // Worth knowing, because it cost a lot of time: whether this is set or not,
  // onnxruntime loads its backend by wrapping the factory in a Blob and doing
  // `import(blob:...)`. Under MV3's `script-src 'self'` that import is refused
  // and BOTH backends die with "no available backend found ... Failed to fetch
  // dynamically imported module: blob:chrome-extension://...". Leaving wasmPaths
  // out does NOT avoid it — measured, twice. The only thing that decides it is
  // whether blob: is in script-src; see the manifest.
  env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
}

env.backends.onnx.wasm.numThreads = 1;

export * from "./transformers.min.js";
