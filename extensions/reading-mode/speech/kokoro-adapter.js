// speech/kokoro-adapter — the speech interface, over Kokoro-82M via HeadTTS.
//
// Same interface as speech/adapter.js: listVoices / speak / stop, four event
// hooks, every event stamped with the token speak() returned. player/controller
// and view/highlighter cannot tell which of the two is underneath, which is the
// whole reason the interface exists.
//
// Where the chrome.tts adapter absorbs Chromium's quirks, this one absorbs a
// different shape of engine. The OS voice is a *player*: you hand it text and it
// speaks, reporting words as it goes. Kokoro is a *synthesiser*: you hand it
// text and wait, and some seconds later you get audio plus a table of word
// timings. Everything below is the consequence of that difference.
//
// Measured on an M-series Mac, fp32 on WebGPU:
//
//   - synthesis runs at ~0.56x real time — a 12s sentence takes ~6.5s to make
//   - so playback never gaps *provided* the next sentence is already being made
//     while the current one plays. That is what prefetch() below is for, and
//     what player/controller's LOOKAHEAD drives.
//   - the first sentence has nothing to hide behind, so warmUp() starts it as
//     soon as the viewer opens rather than when Read aloud is pressed
//   - fp32 is deliberate. q8 measured six times slower on WebGPU, because
//     quantised weights need dequantisation work the GPU handles badly.

const RATE_MIN = 0.6;
const RATE_MAX = 2.5;

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";

// Kokoro's voices are named <language><gender>_<name>. Only the ones actually
// downloaded by fetch-assets.sh are listed; adding a name in both places is all
// it takes to offer another.
const VOICES = [
  { id: "af_heart", label: "Heart", lang: "en-US", quality: "A" },
  { id: "af_bella", label: "Bella", lang: "en-US", quality: "A" },
  { id: "af_nicole", label: "Nicole", lang: "en-US", quality: "B" },
  { id: "af_sarah", label: "Sarah", lang: "en-US", quality: "B" },
  { id: "am_michael", label: "Michael", lang: "en-US", quality: "B" },
  { id: "am_fenrir", label: "Fenrir", lang: "en-US", quality: "B" },
  { id: "am_puck", label: "Puck", lang: "en-US", quality: "B" },
  { id: "bf_emma", label: "Emma", lang: "en-GB", quality: "B" },
  { id: "bm_george", label: "George", lang: "en-GB", quality: "B" },
];

const PREFERRED_VOICE = "af_heart";

export const voiceIds = VOICES.map((v) => v.id);

function clampRate(rate) {
  return Math.min(Math.max(Number(rate) || 1, RATE_MIN), RATE_MAX);
}

export function chooseVoice(voices) {
  return voices.find((v) => v.id === PREFERRED_VOICE) || voices[0] || null;
}

// HeadTTS returns words with their trailing whitespace attached, so summing
// lengths would usually give the offset. Usually is not good enough: the
// phonemiser can drop or fold a token, and one bad offset puts the highlight on
// the wrong word for the rest of the sentence. Searching forward from a cursor
// re-synchronises after any such gap.
function charIndexes(text, words) {
  const indexes = [];
  let cursor = 0;
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) {
      indexes.push(cursor);
      continue;
    }
    const at = text.indexOf(trimmed, cursor);
    if (at < 0) {
      indexes.push(cursor); // not found: keep the previous position rather than jumping
      continue;
    }
    indexes.push(at);
    cursor = at + trimmed.length;
  }
  return indexes;
}

// Where every asset lives, as absolute chrome-extension:// URLs.
//
// markdown-reader, the VS Code sibling this is ported from, needed 235 lines of
// blob staging here: a webview's document and its assets are on two different
// origins, so its TTS worker could not import or fetch anything. An extension
// page and its files share one origin, so all of that disappears — including
// the workerModule override, which is deliberately NOT passed below so that
// HeadTTS resolves ./worker-tts.mjs against its own URL and starts the worker
// directly. That also stays clear of MV3's ban on blob: in script-src.
function assetUrls() {
  const at = (path) => chrome.runtime.getURL(path);
  const query = new URLSearchParams({
    models: at("models/"),
    ortmjs: at("lib/ort/ort-wasm-simd-threaded.asyncify.mjs"),
    ortwasm: at("lib/ort/ort-wasm-simd-threaded.asyncify.wasm"),
  });
  return {
    transformersModule: `${at("lib/transformers/local-transformers.mjs")}?${query}`,
    dictionaryURL: at("lib/headtts/dictionaries/"),
    voiceURL: at("voices/"),
  };
}

export function create({ HeadTTS, audioCtx, onstatus = () => {} } = {}) {
  const listeners = { start: [], word: [], done: [], error: [] };

  let engine = null;
  let ready = null; // the connect() promise, so callers can await one connection
  let nextToken = 1;
  let liveToken = 0;
  let sources = [];
  let timers = [];
  const cache = new Map(); // key -> Promise<{ parts, duration }>

  const context = audioCtx || new AudioContext();

  function emit(kind, ...args) {
    for (const cb of listeners[kind]) cb(...args);
  }

  const keyFor = (text, voice, rate) => `${voice}|${rate}|${text}`;

  function connect() {
    if (ready) return ready;
    onstatus("loading the voice model…");
    engine = new HeadTTS({
      endpoints: ["webgpu", "wasm"],
      languages: ["en-us"],
      audioCtx: context,
      // Every URL points inside the extension folder. Nothing here reaches the
      // network; env.allowRemoteModels is false on the other side to prove it.
      ...assetUrls(),
      model: MODEL,
      // Not a knob to turn: see the header.
      dtypeWebgpu: "fp32",
      // q8 (model_quantized.onnx, 88MB), not markdown-reader's q4: q4 is 291MB,
      // nearly as big as fp32, and q8 is transformers' own default for the wasm
      // device. Whichever is named here must be downloaded by fetch-assets.sh —
      // asking for weights that are not on disk is a 404, and with remote models
      // disabled that throws and takes the whole voice down.
      dtypeWasm: "q8",
    });
    engine.onerror = (err) => emit("error", liveToken, String(err && err.message ? err.message : err));

    // HeadTTS keeps no record of which endpoint won, and the difference matters:
    // wasm works but is far too slow to stay ahead of playback, and falling back
    // to it looks like success until the sentences start gapping. Time-to-ready
    // and whether WebGPU was even a candidate are enough to tell them apart.
    const startedAt = performance.now();
    // The progress handler is wired up because the gap after it matters: reports
    // stop when the download ends, and everything after that — creating the ONNX
    // session, uploading 321MB of weights to the GPU — happens in silence. When
    // a cold start is slow, this says which half it was slow in.
    let lastPercent = -1;
    ready = engine
      .connect(null, (event) => {
        if (!event.lengthComputable || !event.total) return;
        const percent = Math.floor((event.loaded / event.total) * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        if (percent % 25 === 0) console.log(`[kokoro] model ${percent}% loaded`);
        if (percent === 100) console.log("[kokoro] downloaded; building the ONNX session (silent, can take a while)");
        onstatus(`loading the voice model… ${percent}%`);
      })
      .then(() => {
        onstatus("");
        console.log(
          `[kokoro] ready in ${Math.round(performance.now() - startedAt)}ms` +
          ` on ${engine.endpoint || "?"}` +
          `, webgpu ${globalThis.navigator?.gpu ? "available" : "unavailable"}`,
        );
      })
      .catch((err) => {
        ready = null;
        // The message that reaches onstatus is for a human, and HeadTTS's own is
        // usually the generic "Loading models failed." The real cause is in the
        // error, so it goes to the console whole rather than being summarised
        // into uselessness.
        console.error("[kokoro] the voice model failed to load:", err);
        onstatus("the voice model failed to load");
        throw err;
      });
    return ready;
  }

  // Synthesise and cache, without playing. One entry is one sentence.
  function synthesise(text, voice, rate) {
    const key = keyFor(text, voice, rate);
    const hit = cache.get(key);
    if (hit) return hit;

    const promise = connect().then(async () => {
      const parts = [];
      // HeadTTS splits long input into several messages; each carries its own
      // audio and its own timings, relative to its own start.
      const collect = (message) => {
        const data = (message && message.data) || {};
        if (!data.audio) return;
        parts.push({
          audio: data.audio,
          words: data.words || [],
          wtimes: data.wtimes || [],
        });
      };
      await engine.synthesize({ input: text, voice, speed: clampRate(rate) }, collect);
      const duration = parts.reduce((sum, p) => sum + p.audio.duration, 0);
      return { parts, duration };
    });

    cache.set(key, promise);
    // A rejected entry must not poison the cache — the next attempt should try
    // again rather than replay the failure forever.
    promise.catch(() => cache.delete(key));

    // Big enough to hold the sentence playing plus the controller's whole
    // lookahead, or the oldest entry is evicted just before it is reached and the
    // work is done twice. A sentence of audio is about a megabyte, so the ceiling
    // is cheap; what is dropped is audio already spoken.
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return promise;
  }

  function clearPlayback() {
    for (const node of sources) {
      try {
        node.onended = null;
        node.stop();
      } catch {}
    }
    for (const timer of timers) clearTimeout(timer);
    sources = [];
    timers = [];
  }

  return {
    // Kokoro's voices are a fixed list shipped with the model, not a property of
    // the machine — so unlike the chrome.tts adapter this needs no enumeration
    // and cannot come back empty.
    async listVoices() {
      return VOICES.map((v) => ({
        ...v,
        local: true,
        novelty: false,
        premium: true,
        supportsWordEvents: true,
        // Which one to pick when nothing is remembered. Reported rather than
        // decided by chooseVoice() below, because reading-mode's picker runs in
        // a content script that never imports this file — the model lives in an
        // iframe and only its voice list crosses over.
        preferred: v.id === PREFERRED_VOICE,
      }));
    },

    // Start loading the model before anyone presses play, and optionally get the
    // first sentence under way. Without this the first press waits for both.
    async warmUp(text, { voice = PREFERRED_VOICE, rate = 1 } = {}) {
      try {
        await connect();
        if (text) synthesise(text, voice, rate).catch(() => {});
      } catch {
        /* connect() already reported through onstatus and onerror */
      }
    },

    // Called by the controller for the *next* sentence while the current one is
    // playing. This is what keeps playback gapless: synthesis runs at ~0.56x
    // real time, so a sentence is ready well before the one before it ends.
    prefetch(text, { voice = PREFERRED_VOICE, rate = 1 } = {}) {
      if (!text) return;
      synthesise(text, voice, rate).catch(() => {});
    },

    speak(text, { voice = PREFERRED_VOICE, rate = 1 } = {}) {
      const token = nextToken++;
      liveToken = token;
      clearPlayback();

      // Synchronously, before any await: Chromium only honours resume() from
      // inside the user gesture that caused it, and speak() is reached straight
      // from the play click or keypress. The awaited resume further down covers
      // the case where this one was still pending when the audio was ready.
      if (context.state === "suspended") context.resume().catch(() => {});

      synthesise(text, voice, rate)
        .then(async ({ parts, duration }) => {
          // Chromium starts an AudioContext suspended until a user gesture, and
          // this one is created when the viewer opens — long before anyone
          // presses play. Scheduling onto a suspended context is silent, and
          // silent in a way that hides itself: the word events below are timers,
          // so the highlight marches happily through a sentence nobody can hear.
          // speak() is only ever reached from a click or a keypress, so resuming
          // here is inside the gesture that permits it.
          if (context.state === "suspended") {
            try {
              await context.resume();
            } catch {
              /* reported by the catch below if it actually matters */
            }
          }

          // Cancelled while we were synthesising: drop it. The token guard is
          // the same one the chrome.tts adapter needs, for the same reason.
          if (token !== liveToken) return;
          if (!duration) {
            emit("done", token);
            return;
          }

          emit("start", token, 0);

          const startAt = context.currentTime + 0.02;
          // How long until the first sample is heard. Zero in practice, but if
          // resuming took a moment this keeps the highlight on the audio rather
          // than ahead of it.
          const leadMs = Math.max(0, (startAt - context.currentTime) * 1000);
          let at = startAt;
          let elapsedMs = 0;

          parts.forEach((part, index) => {
            const node = context.createBufferSource();
            node.buffer = part.audio;
            node.connect(context.destination);
            node.start(at);
            sources.push(node);

            // The last buffer ending is the sentence ending. Scheduling this on
            // the audio clock rather than a timer keeps it in step with what is
            // actually being heard.
            if (index === parts.length - 1) {
              node.onended = () => {
                if (token !== liveToken) return;
                liveToken = 0;
                emit("done", token);
              };
            }

            // Word events, replayed from the model's own timings. The delay is
            // measured from now rather than from playback start so that a late
            // schedule cannot drift.
            const offsets = charIndexes(text, part.words);
            const base = elapsedMs;
            part.wtimes.forEach((wtime, i) => {
              const delay = leadMs + base + wtime;
              timers.push(
                setTimeout(() => {
                  if (token !== liveToken) return;
                  emit("word", token, offsets[i]);
                }, delay)
              );
            });

            at += part.audio.duration;
            elapsedMs += part.audio.duration * 1000;
          });
        })
        .catch((err) => {
          if (token !== liveToken) return;
          liveToken = 0;
          emit("error", token, String(err && err.message ? err.message : err));
        });

      return token;
    },

    stop() {
      liveToken = 0;
      clearPlayback();
    },

    onStart: (cb) => listeners.start.push(cb),
    onWord: (cb) => listeners.word.push(cb),
    onDone: (cb) => listeners.done.push(cb),
    onError: (cb) => listeners.error.push(cb),
  };
}

export const rateRange = { min: RATE_MIN, max: RATE_MAX };
