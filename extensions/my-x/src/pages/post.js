/*
 * The copy button, on a post's own page.
 *
 * Unrelated to the filter. It shares the tick and nothing else: home.js does
 * not know this file exists, and this file never hides anything. It stands
 * down anywhere that is not /<user>/status/<id>.
 *
 * Registered after home.js so that on a status page — where home.js has just
 * set the bar to "idle" — a problem here can overwrite it.
 */

const COPY_CLASS = "myx-copy-btn";
const DONE_MS = 1500;

/* Two overlapping rounded squares, drawn at the weight of X's own icons. */
const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <rect x="9" y="9" width="12" height="12" rx="2.5"></rect>
  <path d="M6 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V6"></path>
</svg>`;

const ICON_DONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <path d="M4 12.5 9.5 18 20 6"></path>
</svg>`;

let resetTimer = null;

/* The slot goes too, or the action row keeps its trailing gap. */
function unstampCopy() {
  clearTimeout(resetTimer);
  for (const s of document.querySelectorAll("." + COPY_CLASS + "__slot")) {
    s.remove();
  }
}

function flashCopy(button, ok) {
  clearTimeout(resetTimer);
  button.innerHTML = ok ? ICON_DONE : ICON_COPY;
  button.classList.toggle(COPY_CLASS + "--done", ok);
  button.classList.toggle(COPY_CLASS + "--failed", !ok);
  button.title = ok ? "Copied" : "Could not copy";

  resetTimer = setTimeout(() => {
    button.innerHTML = ICON_COPY;
    button.classList.remove(COPY_CLASS + "--done", COPY_CLASS + "--failed");
    button.title = "Copy this post's text";
  }, DONE_MS);
}

/*
 * Put the button on this post if it has none, and re-point it at the text as
 * it reads right now. Re-read every pass rather than closed over once: X can
 * rewrite the article under us — a "Show more" expanding is exactly that.
 *
 * Returns false when the action row is not where we expect it. Said out loud
 * by the caller rather than swallowed: we found the post and we have its
 * text, so the only thing missing is the place to hang the button, and that
 * is a selector that has gone stale.
 */
function stampCopy(article, text) {
  let button = article.querySelector("." + COPY_CLASS);

  if (!button) {
    const bar = MyX.extract.actionBar(article);
    if (!bar) return false;

    button = document.createElement("button");
    button.className = COPY_CLASS;
    button.innerHTML = ICON_COPY;
    button.title = "Copy this post's text";

    /* Never let the click reach X underneath, which would open the post. */
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(button.dataset.myxText);
        flashCopy(button, true);
      } catch (err) {
        console.error("[my-x] copy failed", err);
        flashCopy(button, false);
      }
    });

    /*
     * Every child of the action row is a wrapper, and the four counted
     * actions each carry flex-grow: 1 while share does not. Ours is a
     * fixed-width wrapper on the end, so it takes the space share leaves and
     * never stretches the row.
     */
    const slot = document.createElement("div");
    slot.className = COPY_CLASS + "__slot";
    slot.append(button);
    bar.append(slot);
  }

  button.dataset.myxText = text;
  return true;
}

function copyPass() {
  if (!MyX.extract.statusId()) {
    unstampCopy();
    return;
  }

  const article = MyX.extract.focusedPost();
  if (!article) {
    unstampCopy();
    /*
     * No article at all yet is just the page still loading, and normal on
     * every pass until it arrives. Articles but none of them ours means the
     * selectors have gone stale, which is worth saying out loud.
     */
    if (MyX.extract.hasArticles()) {
      MyX.bar.say(
        `could not find this post (extract v${MyX.EXTRACT_VERSION})`,
        true
      );
    }
    return;
  }

  const text = MyX.extract.postText(article);

  /* Nothing to copy — an image on its own. */
  if (!text) {
    unstampCopy();
    return;
  }

  if (!stampCopy(article, text)) {
    MyX.bar.say(
      `could not place the copy button (extract v${MyX.EXTRACT_VERSION})`,
      true
    );
  }
}

MyX.onTick(copyPass);
