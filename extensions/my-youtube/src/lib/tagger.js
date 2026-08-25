/*
 * The tag button on each card, and the popup it opens.
 *
 * One popup element, moved and refilled, rather than one per card. It closes
 * on scroll rather than trying to follow its card: the grid reflows whenever
 * anything is hidden, so a popup anchored to a card would be left pointing at
 * empty space.
 *
 * Every button is re-pointed at its card's current video on every pass. That
 * is not belt-and-braces here as it is on X: YouTube really does bind a
 * different video into a card that never moves, and a button that had quietly
 * come to belong to another channel would tag the wrong one.
 *
 * The button is positioned rather than inserted into a row. YouTube's metadata
 * block is a flex row of avatar, text and the "..." button, and the "..." is
 * absolutely positioned in its top-right corner. There is no row to join, so
 * the tag button is absolutely positioned in the same corner, below it, where
 * the metadata lines leave the right-hand side empty.
 */

const TAG_BTN_CLASS = "myyt-tag-btn";

let tagPopup = null;
let tagPopupFor = null; /* the channel the popup is currently about */

function closeTagPopup() {
  if (tagPopup) tagPopup.remove();
  tagPopup = null;
  tagPopupFor = null;
}

function tagChip(label, title, onClick, extraClass) {
  const b = document.createElement("button");
  b.className = "myyt-chip" + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function openTagPopup(button, channelId, channelName) {
  closeTagPopup();
  tagPopupFor = channelId;

  tagPopup = document.createElement("div");
  tagPopup.className = "myyt-popup";

  /* A click anywhere inside must not reach the card underneath, which would
   * navigate away mid-tag. */
  tagPopup.addEventListener("click", (e) => e.stopPropagation());

  const head = document.createElement("div");
  head.className = "myyt-popup__head";
  head.textContent = channelName;
  tagPopup.append(head);

  const on = MyYT.tags.tagsFor(channelId);
  const rest = MyYT.tags.allTags().filter((t) => !on.includes(t));

  const row = document.createElement("div");
  row.className = "myyt-popup__chips";

  for (const t of on) {
    row.append(
      tagChip(
        t,
        `Take ${t} off ${channelName}`,
        () => {
          MyYT.tags.remove(channelId, t);
          applyTag(button, channelId, channelName);
        },
        "myyt-chip--on"
      )
    );
  }
  for (const t of rest) {
    row.append(
      tagChip(t, `Tag ${channelName} as ${t}`, () => {
        MyYT.tags.add(channelId, t);
        applyTag(button, channelId, channelName);
      })
    );
  }
  tagPopup.append(row);

  const input = document.createElement("input");
  input.className = "myyt-popup__input";
  input.type = "text";
  input.placeholder = "new tag…";

  /* YouTube listens for bare keys as shortcuts — typing "k" in here would
   * otherwise pause a video somewhere on the page. */
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closeTagPopup();
    if (e.key !== "Enter" || !input.value.trim()) return;
    MyYT.tags.add(channelId, input.value);
    applyTag(button, channelId, channelName);
  });
  tagPopup.append(input);

  document.body.append(tagPopup);

  /* Fixed positioning, so viewport coordinates and no scroll offsets. */
  const r = button.getBoundingClientRect();
  const w = tagPopup.offsetWidth;
  tagPopup.style.left =
    Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  tagPopup.style.top =
    (r.bottom + tagPopup.offsetHeight > innerHeight
      ? Math.max(8, r.top - tagPopup.offsetHeight - 4)
      : r.bottom + 4) + "px";

  input.focus();
}

/* A tag changed: redraw the feed, the bar's chips, and the popup itself. */
function applyTag(button, channelId, channelName) {
  MyYT.bar.refreshTags();
  MyYT.tickNow();
  if (tagPopupFor === channelId && document.contains(button)) {
    openTagPopup(button, channelId, channelName);
  } else {
    closeTagPopup();
  }
}

MyYT.tagger = {
  /*
   * Put a button on this card if it has none, and point it at this video.
   * Cheap enough to call for every visible card on every pass.
   */
  stamp(card, video) {
    let button = card.querySelector("." + TAG_BTN_CLASS);

    if (!button) {
      const host = MyYT.menuHost(card);
      if (!host) return;

      button = document.createElement("button");
      button.className = TAG_BTN_CLASS;
      button.textContent = "#";
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (tagPopupFor === button.dataset.myytChannel) closeTagPopup();
        else {
          openTagPopup(
            button,
            button.dataset.myytChannel,
            button.dataset.myytName
          );
        }
      });

      host.append(button);
    }

    button.dataset.myytChannel = video.channelId;
    button.dataset.myytName = video.channelName;

    const tags = MyYT.tags.tagsFor(video.channelId);
    button.title = tags.length
      ? `${video.channelName}: ${tags.join(", ")}`
      : `Tag ${video.channelName}`;
    button.classList.toggle("myyt-tag-btn--tagged", tags.length > 0);
  },

  /* Off the homepage, or frozen: take every button back off again. */
  unstampAll() {
    closeTagPopup();
    for (const b of document.querySelectorAll("." + TAG_BTN_CLASS)) b.remove();
  },

  closePopup: closeTagPopup,
};

addEventListener("scroll", closeTagPopup, { passive: true, capture: true });
addEventListener("keydown", (e) => e.key === "Escape" && closeTagPopup());
addEventListener("click", (e) => {
  if (
    tagPopup &&
    !tagPopup.contains(e.target) &&
    !e.target.closest("." + TAG_BTN_CLASS)
  ) {
    closeTagPopup();
  }
});
