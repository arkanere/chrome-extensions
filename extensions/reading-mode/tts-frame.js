// tts-frame — speech/kokoro-adapter, hosted where it is allowed to run.
//
// The reader is a content script and cannot run the model itself (see
// tts-frame.html). So it injects this page as a hidden iframe and talks to it
// over a MessagePort: speak / stop / warmUp / prefetch / voices go down, and the
// adapter's four events come back up, every one stamped with the token the
// caller was given.
//
// The audio is played here too, by the adapter's own AudioContext. That is the
// reason the iframe carries allow="autoplay": user activation is per-frame, so
// the click on Read aloud activates the article page and not this one, and
// without the delegation the context would stay suspended — silently, while the
// highlight marched on regardless.
//
// A MessagePort rather than window.postMessage because the article page shares a
// DOM with the reader and can post into this frame. It cannot reach the port.

import { HeadTTS } from "./lib/headtts/headtts.mjs";
import * as kokoroAdapter from "./speech/kokoro-adapter.js";

let port = null;
let backlog = [];

// Everything this frame has to say goes back to the reader, because this frame's
// console is a different context from the page's and the reader is where anyone
// debugging is actually looking.
function say(text) {
  if (port) port.postMessage({ type: "log", text });
  else backlog.push(text);
}

const speech = kokoroAdapter.create({
  HeadTTS,
  onstatus: (text) => text && say(text),
});

// A module that fails to load leaves this frame alive but mute, which from the
// reader's side is indistinguishable from a frame that was never allowed to
// exist. Say which it was.
window.addEventListener("error", (event) => {
  say(`frame error: ${event.message}${event.filename ? ` @ ${event.filename}:${event.lineno}` : ""}`);
});
window.addEventListener("unhandledrejection", (event) => {
  say(`frame error: ${event.reason && event.reason.message ? event.reason.message : event.reason}`);
});

// The adapter numbers its own utterances; the reader numbers its own. Only one
// is ever in flight, so a single pair holds the whole translation.
let inner = 0;
let outer = 0;

function send(message) {
  if (port) port.postMessage(message);
}

function forward(kind) {
  return (token, arg) => {
    // An event from an utterance that is no longer the live one. The adapter
    // already drops most of these; this covers the rest.
    if (token !== inner) return;
    send({ type: "event", kind, token: outer, arg });
  };
}

speech.onStart(forward("start"));
speech.onWord(forward("word"));
speech.onDone(forward("done"));
speech.onError(forward("error"));

function handle(message) {
  const data = message || {};
  switch (data.type) {
    case "voices":
      speech.listVoices().then((voices) => send({ type: "voices", id: data.id, voices }));
      break;

    case "speak":
      outer = data.token;
      inner = speech.speak(data.text, data.options);
      break;

    case "stop":
      inner = 0;
      speech.stop();
      break;

    case "warmUp":
      speech.warmUp(data.text, data.options);
      break;

    case "prefetch":
      speech.prefetch(data.text, data.options);
      break;
  }
}

// The handshake, and the only thing this frame accepts from window.postMessage.
// Everything after it arrives on the port. content.js attaches its load listener
// before it appends the iframe, so this listener is always in place first: a
// module script defers, and the frame's load event waits for it.
window.addEventListener("message", (event) => {
  if (port || !event.data || event.data.type !== "rm-tts-connect") return;
  port = event.ports[0];
  if (!port) return;
  port.onmessage = (e) => handle(e.data);
  port.start();
  // Proof of life. Until this arrives the reader cannot tell a frame that is
  // still loading from one the page's CSP refused to frame at all.
  port.postMessage({ type: "hello" });
  for (const text of backlog) port.postMessage({ type: "log", text });
  backlog = [];
});
