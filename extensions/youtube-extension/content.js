// YouTube Ad Skipper — click "Skip" as soon as it becomes clickable.
//
// YouTube renders the skip button well before the countdown ends: the element is
// in the DOM the whole time, just hidden or disabled. So the job is not "wait for
// the button to appear", it is "notice the moment it becomes clickable". A short
// poll is the simplest thing that does that, and querySelector over a handful of
// classes costs nothing.
//
// The class names have changed a few times over the years and old ones still show
// up on some clients, so all the ones known to be in use are listed together.

(() => {
  const POLL_MS = 200;

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',        // current
    '.ytp-ad-skip-button-modern', // previous
    '.ytp-ad-skip-button',        // older still
  ].join(', ');

  function clickable(el) {
    // offsetParent is null for anything display:none, which is how the button
    // spends the countdown. A zero-size box means it is there but not laid out yet.
    if (!el || el.disabled || el.offsetParent === null) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function skip() {
    for (const el of document.querySelectorAll(SKIP_SELECTORS)) {
      if (clickable(el)) {
        el.click();
        return;
      }
    }
  }

  setInterval(skip, POLL_MS);
})();
