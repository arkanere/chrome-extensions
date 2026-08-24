/*
 * The tag button on each post, and the popup it opens.
 *
 * One popup element, moved and refilled, rather than one per post. It closes
 * on scroll rather than trying to follow its post: X removes cells that scroll
 * away, so a popup anchored to one would be left pointing at nothing.
 *
 * Every button is re-pointed at its cell's current post on every pass. X does
 * not appear to recycle cells, but a button that has quietly come to belong to
 * a different account would tag the wrong person, which is worth two lines to
 * rule out.
 */

const BTN_CLASS = "myx-tag-btn";

let popup = null;
let openFor = null; /* the handle the popup is currently about */

function closePopup() {
  if (popup) popup.remove();
  popup = null;
  openFor = null;
}

function chip(label, title, onClick, extraClass) {
  const b = document.createElement("button");
  b.className = "myx-chip" + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function openPopup(button, handle) {
  closePopup();
  openFor = handle;

  popup = document.createElement("div");
  popup.className = "myx-popup";
  popup.dataset.myxTheme =
    document.getElementById("myx-bar")?.dataset.myxTheme || "light";

  /* A click anywhere inside must not reach the post underneath, which would
   * navigate away mid-tag. */
  popup.addEventListener("click", (e) => e.stopPropagation());

  const head = document.createElement("div");
  head.className = "myx-popup__head";
  head.textContent = "@" + handle;
  popup.append(head);

  const on = MyX.tags.tagsFor(handle);
  const rest = MyX.tags.allTags().filter((t) => !on.includes(t));

  const row = document.createElement("div");
  row.className = "myx-popup__chips";

  for (const t of on) {
    row.append(
      chip(t, `Take ${t} off @${handle}`, () => {
        MyX.tags.remove(handle, t);
        apply(button, handle);
      }, "myx-chip--on")
    );
  }
  for (const t of rest) {
    row.append(
      chip(t, `Tag @${handle} as ${t}`, () => {
        MyX.tags.add(handle, t);
        apply(button, handle);
      })
    );
  }
  popup.append(row);

  const input = document.createElement("input");
  input.className = "myx-popup__input";
  input.type = "text";
  input.placeholder = "new tag…";
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closePopup();
    if (e.key !== "Enter" || !input.value.trim()) return;
    MyX.tags.add(handle, input.value);
    apply(button, handle);
  });
  popup.append(input);

  document.body.append(popup);

  /* Fixed positioning, so viewport coordinates and no scroll offsets. */
  const r = button.getBoundingClientRect();
  const w = popup.offsetWidth;
  popup.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  popup.style.top =
    (r.bottom + popup.offsetHeight > innerHeight
      ? Math.max(8, r.top - popup.offsetHeight - 4)
      : r.bottom + 4) + "px";

  input.focus();
}

/* A tag changed: redraw the feed, and the bar's chips, and the popup itself. */
function apply(button, handle) {
  MyX.bar.refreshTags();
  MyX.tickNow();
  if (openFor === handle && document.contains(button)) openPopup(button, handle);
  else closePopup();
}

MyX.tagger = {
  /*
   * Put a button on this cell if it has none, and point it at this post. Cheap
   * enough to call for every visible cell on every pass.
   */
  stamp(cell, post) {
    let button = cell.querySelector("." + BTN_CLASS);

    if (!button) {
      const menu = MyX.extract.menuButton(cell);
      if (!menu) return;

      button = document.createElement("button");
      button.className = BTN_CLASS;
      button.textContent = "#";
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openFor === button.dataset.myxHandle) closePopup();
        else openPopup(button, button.dataset.myxHandle);
      });

      /* The "..." menu sits in a wrapper of its own; go in beside it. */
      menu.parentElement.parentElement.insertBefore(button, menu.parentElement);
    }

    button.dataset.myxHandle = post.author;
    const tags = MyX.tags.tagsFor(post.author);
    button.title = tags.length
      ? `@${post.author}: ${tags.join(", ")}`
      : `Tag @${post.author}`;
    button.classList.toggle("myx-tag-btn--tagged", tags.length > 0);
  },

  /* Off, or off For You: take every button back off again. */
  unstampAll() {
    closePopup();
    for (const b of document.querySelectorAll("." + BTN_CLASS)) b.remove();
  },

  closePopup,
};

addEventListener("scroll", closePopup, { passive: true, capture: true });
addEventListener("keydown", (e) => e.key === "Escape" && closePopup());
addEventListener("click", (e) => {
  if (popup && !popup.contains(e.target) && !e.target.closest("." + BTN_CLASS)) {
    closePopup();
  }
});
