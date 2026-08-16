// speech/adapter — the section 5.1 interface over chrome.tts.
//
// Its job is to absorb the three quirks measured in 2.3 and confirmed in 2.5, so
// that nothing upstream ever sees them:
//
//   1. Natural voices fire `start` eight times per utterance. We latch the first.
//   2. Natural voices fire two `word` events per word, at distinct charIndex
//      values. Those are passed through raw — collapsing them needs the word
//      geometry, which lives in the controller, not here.
//   3. A stopped utterance can still deliver events. Every event carries the
//      token returned by speak(), and events from a dead token are dropped.
//
// It knows nothing about documents, pages or the DOM. Swapping chrome.tts for
// Piper or Kokoro later should touch this file and no other.

// Both voice families honoured rate correctly across this range (2.3). The API
// accepts 0.1–10; those extremes are not worth offering.
const RATE_MIN = 0.6;
const RATE_MAX = 2.5;

// Section 7's chain, in order. Kept here because it is a fact about voices, not
// about the player: phase 6's picker will use the same function.
const PREFERRED_VOICE = "Google US English 1 (Natural)";
const LAST_RESORT_VOICE = "Samantha";

function clampRate(rate) {
  return Math.min(Math.max(Number(rate) || 1, RATE_MIN), RATE_MAX);
}

function toVoiceInfo(voice) {
  return {
    id: voice.voiceName,
    label: voice.voiceName,
    local: voice.remote !== true,
    // 2.5 checked this against every voice on the machine: remote voices all
    // omit `word`, local ones all declare it. No probe utterance needed.
    supportsWordEvents: (voice.eventTypes || []).includes("word"),
  };
}

// Section 7. Returns null when nothing matches, which means "let the platform
// pick" — chrome.tts uses its default voice when voiceName is left off.
export function chooseVoice(voices) {
  return (
    voices.find((v) => v.id === PREFERRED_VOICE) ||
    voices.find((v) => v.local && v.supportsWordEvents) ||
    voices.find((v) => v.id === LAST_RESORT_VOICE) ||
    null
  );
}

export function create(tts = chrome.tts) {
  const listeners = { start: [], word: [], done: [], error: [] };

  let nextToken = 1;
  let liveToken = 0; // the utterance chrome.tts is speaking; 0 means none
  let spokeAt = 0;
  let started = false;

  function emit(kind, ...args) {
    for (const cb of listeners[kind]) cb(...args);
  }

  function handle(token, event) {
    if (token !== liveToken) return; // quirk 3

    switch (event.type) {
      case "start":
        if (started) return; // quirk 1
        started = true;
        emit("start", token, Math.round(performance.now() - spokeAt));
        break;

      case "word":
        emit("word", token, event.charIndex); // quirk 2 stays for the controller
        break;

      case "end":
        liveToken = 0;
        emit("done", token);
        break;

      case "interrupted":
      case "cancelled":
        // Our own stop() has already cleared liveToken, so reaching here means
        // something else took the engine. Either way this utterance is over.
        liveToken = 0;
        break;

      case "error":
        liveToken = 0;
        emit("error", token, event.errorMessage || "the speech engine failed");
        break;
    }
  }

  return {
    listVoices() {
      return new Promise((resolve) => {
        tts.getVoices((voices) => resolve((voices || []).map(toVoiceInfo)));
      });
    },

    // Returns the token that stamps every event from this utterance.
    speak(text, { voice = null, rate = 1 } = {}) {
      const token = nextToken++;
      liveToken = token;
      started = false;
      spokeAt = performance.now();

      const options = {
        rate: clampRate(rate),
        enqueue: false, // the controller schedules sentence by sentence
        onEvent: (event) => handle(token, event),
      };
      if (voice) options.voiceName = voice;

      tts.speak(text, options, () => {
        if (chrome.runtime.lastError && token === liveToken) {
          liveToken = 0;
          emit("error", token, chrome.runtime.lastError.message);
        }
      });

      return token;
    },

    stop() {
      liveToken = 0;
      tts.stop();
    },

    onStart: (cb) => listeners.start.push(cb),
    onWord: (cb) => listeners.word.push(cb),
    onDone: (cb) => listeners.done.push(cb),
    onError: (cb) => listeners.error.push(cb),
  };
}

export const rateRange = { min: RATE_MIN, max: RATE_MAX };
