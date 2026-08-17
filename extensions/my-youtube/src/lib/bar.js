/*
 * The extension's own bar across the top of YouTube.
 *
 * Same idea as the PDF reader's header and #notice: a strip that says the
 * extension is here, and a place for it to tell you something. The difference
 * is that this one is injected into YouTube's page rather than owning the
 * document, so it also has to push YouTube's masthead down (see bar.css).
 *
 * Messages go here rather than only to the console, because a warning nobody
 * opens devtools to read is not a warning.
 */

const BAR_ID = "myyt-bar";

let statusEl = null;
let dismissEl = null;
let pending = null; /* a message that arrived before the bar existed */

function build() {
  if (document.getElementById(BAR_ID)) return;

  const bar = document.createElement("div");
  bar.id = BAR_ID;

  const name = document.createElement("span");
  name.className = "myyt-bar__name";
  name.textContent = "my-youtube";

  statusEl = document.createElement("span");
  statusEl.className = "myyt-bar__status";

  dismissEl = document.createElement("button");
  dismissEl.className = "myyt-bar__dismiss";
  dismissEl.textContent = "×";
  dismissEl.title = "Dismiss this message";
  dismissEl.hidden = true;
  dismissEl.addEventListener("click", () => MyYT.bar.clear());

  bar.append(name, statusEl, dismissEl);
  document.body.prepend(bar);

  if (pending) {
    MyYT.bar.say(pending.text, pending.isError);
    pending = null;
  }
}

MyYT.bar = {
  /*
   * Only the most recent message is shown. Everything the feed reports is a
   * running status ("could not parse N cards"), so a queue would just show
   * stale counts.
   */
  say(text, isError) {
    if (!statusEl) {
      pending = { text, isError };
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.toggle("myyt-bar__status--error", Boolean(isError));

    /* Only a problem is worth dismissing. The ordinary status is replaced by
     * the next scan anyway, so a button to clear it would achieve nothing. */
    dismissEl.hidden = !isError;
  },

  clear() {
    if (!statusEl) {
      pending = null;
      return;
    }
    statusEl.textContent = "";
    statusEl.classList.remove("myyt-bar__status--error");
    dismissEl.hidden = true;
  },
};

/* Content scripts run at document_start, so body may not exist yet. */
if (document.body) {
  build();
} else {
  document.addEventListener("DOMContentLoaded", build);
}
