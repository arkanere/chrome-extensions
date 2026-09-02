// speech/dual — one speech interface over two engines.
//
// Kokoro (speech/kokoro-adapter) and chrome.tts (speech/adapter) implement the
// same interface, and this presents both as one so that player/controller and
// view/highlighter carry on knowing about neither. Voices from both appear in a
// single list; whichever engine owns the selected voice id does the speaking.
//
// Two things make this more than a switch statement:
//
//   1. TOKENS. Each engine numbers its own utterances from 1, so the same number
//      means different things underneath. This mints its own token per speak()
//      and translates, which also drops any event arriving late from the engine
//      that is no longer playing.
//
//   2. FALLBACK. Kokoro needs a 326MB model that fetch-assets.sh may never have
//      been run to get, and a GPU or wasm backend that may not start. That
//      failure arrives asynchronously, as an error on the first utterance — long
//      after the voice list was built. So the first Kokoro error retires Kokoro
//      for the session and re-speaks that same sentence on chrome.tts, with the
//      caller's token unchanged. The listener never learns it happened; the
//      reader just keeps reading.

export function create({ kokoro, system, onfallback = () => {} }) {
  const listeners = { start: [], word: [], done: [], error: [] };

  let kokoroVoices = new Set();
  let kokoroDead = false;
  let nextToken = 1;
  // The one utterance in flight: which engine is speaking it, that engine's
  // token, and the token we handed the caller.
  let live = null;

  function emit(kind, ...args) {
    for (const cb of listeners[kind]) cb(...args);
  }

  const owns = (engine, token) => live && live.engine === engine && live.inner === token;

  function ownerFor(voiceId) {
    return !kokoroDead && voiceId && kokoroVoices.has(voiceId) ? kokoro : system;
  }

  // Which engine speaks this, and with what. The second half matters after a
  // fallback: the picker is still showing "Heart", but chrome.tts has never
  // heard of it and would fail on every sentence. Drop the name and let the
  // platform choose, which is what speech/adapter does with a null voice.
  function route(options) {
    const engine = ownerFor(options.voice);
    if (engine === system && options.voice && kokoroVoices.has(options.voice)) {
      return { engine, options: { ...options, voice: null } };
    }
    return { engine, options };
  }

  // Kokoro could not start. Retire it and hand the sentence to chrome.tts,
  // keeping the caller's token so the controller never sees a seam.
  function fallback(message) {
    if (!kokoroDead) {
      kokoroDead = true;
      onfallback(message);
    }
    if (!live || live.engine !== kokoro) return;
    live.engine = system;
    live.inner = system.speak(live.text, { voice: null, rate: live.rate });
  }

  function bind(engine) {
    engine.onStart((token, ms) => {
      if (owns(engine, token)) emit("start", live.outer, ms);
    });
    engine.onWord((token, charIndex) => {
      if (owns(engine, token)) emit("word", live.outer, charIndex);
    });
    engine.onDone((token) => {
      if (!owns(engine, token)) return;
      const outer = live.outer;
      live = null;
      emit("done", outer);
    });
    engine.onError((token, message) => {
      // A Kokoro failure is worth acting on even when it arrives with no live
      // utterance — connect() reports that way when the model is missing.
      if (engine === kokoro) {
        if (owns(engine, token)) {
          fallback(message);
          return;
        }
        if (!kokoroDead) {
          kokoroDead = true;
          onfallback(message);
        }
        return;
      }
      if (!owns(engine, token)) return;
      const outer = live.outer;
      live = null;
      emit("error", outer, message);
    });
  }

  bind(kokoro);
  bind(system);

  return {
    // Kokoro first: they are the voices this is built around, and controls.js
    // groups them above the system ones anyway.
    async listVoices() {
      const [neural, platform] = await Promise.all([kokoro.listVoices(), system.listVoices()]);
      kokoroVoices = new Set(neural.map((v) => v.id));
      return kokoroDead ? platform : [...neural, ...platform];
    },

    // Both are safe to call for a voice whose engine does not implement them.
    warmUp(text, options = {}) {
      const { engine, options: opts } = route(options);
      return engine.warmUp ? engine.warmUp(text, opts) : Promise.resolve();
    },

    prefetch(text, options = {}) {
      const { engine, options: opts } = route(options);
      if (engine.prefetch) engine.prefetch(text, opts);
    },

    speak(text, options = {}) {
      const { engine, options: opts } = route(options);
      const outer = nextToken++;
      // Recorded before speak() returns, so that the first event to arrive has a
      // live utterance to match against.
      live = { engine, inner: 0, outer, text, rate: options.rate ?? 1 };
      live.inner = engine.speak(text, opts);
      return outer;
    },

    stop() {
      live = null;
      // Both, always. The other engine holding a stale utterance is exactly the
      // case a fallback leaves behind.
      kokoro.stop();
      system.stop();
    },

    onStart: (cb) => listeners.start.push(cb),
    onWord: (cb) => listeners.word.push(cb),
    onDone: (cb) => listeners.done.push(cb),
    onError: (cb) => listeners.error.push(cb),
  };
}
