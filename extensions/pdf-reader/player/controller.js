// player/controller — the queue and the current Position.
//
// Speaks one sentence at a time, maps the adapter's charIndex onto a word, and
// emits a Position only when the word actually changes. That last step is what
// collapses Natural's two boundary events per word (2.3, quirk 2).
//
// It knows nothing about pdf.js, the DOM or any particular voice. It sees the
// document only through core/document-model and the engine only through the
// section 5.1 adapter.

// Pause is stop-and-remember (section 6): we drop the utterance and keep the
// Position, so resume re-speaks the current sentence from its start. One code
// path serves pause, seek and resume-on-open.

export function create(model, speech, config = {}) {
  const listeners = { position: [], state: [], error: [], end: [] };

  let voice = config.voice ?? null;
  let rate = config.rate ?? 1;

  let playing = false;
  let sentenceId = config.sentenceId ?? 0;
  let wordIndex = -1; // -1 = sentence started, no word spoken yet
  let liveToken = 0;

  function emit(kind, ...args) {
    for (const cb of listeners[kind]) cb(...args);
  }

  const emitPosition = () => emit("position", { sentenceId, wordIndex });
  const emitState = () => emit("state", { playing, sentenceId });

  // The last word starting at or before charIndex. Natural's second event for a
  // word lands on the whitespace after it, which maps back to the same word and
  // is then dropped by the changed-word test in onWord.
  function wordAt(sentence, charIndex) {
    let found = -1;
    for (let i = 0; i < sentence.words.length; i++) {
      if (sentence.words[i].start > charIndex) break;
      found = i;
    }
    return found;
  }

  // Sentences arrive as pages are parsed, so walk the model forward until the id
  // exists or the document runs out.
  async function ensureSentence(id) {
    while (id >= model.sentences.length && model.parsedPages < model.pageCount) {
      await model.ensurePages(model.parsedPages + 1);
    }
    return id < model.sentences.length;
  }

  // Parsing a page mid-sentence would be heard as a gap, so pull the next one in
  // while the current sentence is still being spoken. Audio pre-buffering is a
  // separate, deferred idea (section 6); this is just the text.
  function prefetch(page) {
    if (page <= model.pageCount) model.ensurePages(page).catch(() => {});
  }

  function speakCurrent() {
    const sentence = model.sentence(sentenceId);
    if (!sentence) return;

    wordIndex = -1;
    liveToken = speech.speak(sentence.text, { voice, rate });
    emitPosition();
    prefetch(sentence.page + 1);
  }

  speech.onWord((token, charIndex) => {
    if (token !== liveToken) return;

    const sentence = model.sentence(sentenceId);
    if (!sentence) return;

    const index = wordAt(sentence, charIndex);
    if (index === wordIndex || index < 0) return; // the duplicate boundary event
    wordIndex = index;
    emitPosition();
  });

  speech.onDone(async (token) => {
    if (token !== liveToken) return;
    liveToken = 0;

    const next = sentenceId + 1;
    if (!(await ensureSentence(next))) {
      playing = false;
      emitState();
      emit("end");
      return;
    }

    sentenceId = next;
    wordIndex = -1;
    if (playing) speakCurrent();
    else emitPosition();
  });

  // Section 8: stop, keep the position, let the caller offer resume.
  speech.onError((token, message) => {
    if (token !== liveToken) return;
    liveToken = 0;
    playing = false;
    emitState();
    emit("error", message);
  });

  async function play() {
    if (playing) return;
    if (!(await ensureSentence(sentenceId))) return;

    playing = true;
    emitState();
    speakCurrent();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    liveToken = 0;
    speech.stop();
    emitState();
  }

  async function seek(id) {
    const target = Math.max(0, id);
    if (!(await ensureSentence(target))) return;

    sentenceId = target;
    wordIndex = -1;
    if (playing) {
      speech.stop();
      speakCurrent();
    } else {
      emitPosition();
    }
  }

  return {
    play,
    pause,
    seek,
    toggle: () => (playing ? pause() : play()),
    next: () => seek(sentenceId + 1),
    previous: () => seek(sentenceId - 1),

    get playing() {
      return playing;
    },
    get position() {
      return { sentenceId, wordIndex };
    },

    // Changing either mid-sentence restarts it, which is the same
    // stop-and-remember path as pause. Phase 6's controls use these.
    setVoice(id) {
      voice = id;
      if (playing) {
        speech.stop();
        speakCurrent();
      }
    },
    setRate(value) {
      rate = value;
      if (playing) {
        speech.stop();
        speakCurrent();
      }
    },

    onPosition: (cb) => listeners.position.push(cb),
    onState: (cb) => listeners.state.push(cb),
    onError: (cb) => listeners.error.push(cb),
    onEnd: (cb) => listeners.end.push(cb),
  };
}
