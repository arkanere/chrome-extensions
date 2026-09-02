// view/controls — play/pause, speed, voice.
//
// It builds its own markup into a container and reports every change through the
// handlers it is given. It never touches the player or storage itself: viewer.js
// decides that a voice change means "tell the controller and remember it". That
// keeps this file about widgets only, and keeps the player replaceable.
//
// Section 7: voices that report no word boundary events are left out of the
// picker rather than offered and then failing to highlight. The single exception
// is a voice already in use — if the section 7 chain had to fall through to one,
// the picker has to show what is actually speaking.

function button(label, title, action) {
  const el = document.createElement("button");
  el.textContent = label;
  el.title = title;
  el.dataset.action = action;
  return el;
}

// Three groups now, in the order you would want them. Kokoro's voices come
// first: they run on this machine, they always report word timing, and they are
// the same nine everywhere, which is the point of shipping the model. The
// Natural voices are what this extension was originally built around (2.2), and
// on this machine they arrive buried among ~190 macOS system voices. A voice
// reports itself as premium only if it is Kokoro's — speech/adapter never sets
// the field, so chrome.tts's voices sort exactly as they always did.
function optionsFor(voices, currentId) {
  const seen = new Set();
  const neural = [];
  const natural = [];
  const system = [];

  for (const voice of voices) {
    if (seen.has(voice.id)) continue;
    if (!voice.supportsWordEvents && voice.id !== currentId) continue;
    seen.add(voice.id);
    if (voice.premium) neural.push(voice);
    else (voice.label.includes("(Natural)") ? natural : system).push(voice);
  }
  return [
    ["Neural voices", neural],
    ["Natural voices", natural],
    ["System voices", system],
  ].filter(([, list]) => list.length > 0);
}

function voicePicker(voices, currentId) {
  const select = document.createElement("select");
  select.id = "voice";
  select.title = "Voice";

  for (const [label, list] of optionsFor(voices, currentId)) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const voice of list) {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.supportsWordEvents ? voice.label : `${voice.label} (no highlighting)`;
      group.append(option);
    }
    select.append(group);
  }

  // currentId is null when section 7 fell all the way through to "let the
  // platform decide", and it can also name a voice we filtered out entirely.
  // Either way, show the first thing we do have rather than an empty box.
  if (currentId && select.querySelector(`option[value="${CSS.escape(currentId)}"]`)) select.value = currentId;
  return select;
}

function rateSlider(rate, range) {
  const label = document.createElement("label");
  label.className = "speed";

  const input = document.createElement("input");
  input.type = "range";
  input.id = "rate";
  input.min = range.min;
  input.max = range.max;
  input.step = 0.05;
  input.value = rate;
  input.title = "Reading speed";

  const readout = document.createElement("span");
  readout.className = "speed-value";

  label.append(input, readout);
  return { label, input, readout };
}

// handlers: { toggle, voice(id), rate(value) }
export function create(container, { voices, voice, rate, rateRange }, handlers) {
  const play = button("Read aloud", "Read aloud (pause)", "play");
  const speed = rateSlider(rate, rateRange);
  const picker = voicePicker(voices, voice);

  play.className = "wide";

  const buttons = [play];
  container.append(play, speed.label, picker);

  function showRate(value) {
    speed.readout.textContent = `${Number(value).toFixed(2).replace(/0$/, "")}×`;
  }
  showRate(rate);

  play.addEventListener("click", () => handlers.toggle());

  // input fires per drag step; the player restarts the current sentence on every
  // change (section 6's stop-and-remember), so only commit on release.
  speed.input.addEventListener("input", () => showRate(speed.input.value));
  speed.input.addEventListener("change", () => handlers.rate(Number(speed.input.value)));

  picker.addEventListener("change", () => handlers.voice(picker.value));

  return {
    setPlaying(playing) {
      play.textContent = playing ? "Pause" : "Read aloud";
    },

    // Nothing is playable until a document with a text layer is loaded. The
    // voice and speed stay live either way — they are preferences, not playback.
    setEnabled(enabled) {
      for (const el of buttons) el.disabled = !enabled;
    },
  };
}
