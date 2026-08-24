/*
 * The extension's own bar, and the tag manager.
 *
 * Same idea as my-youtube's: a strip that says the extension is here, and a
 * place for it to tell you something, because a warning that only reaches the
 * console is not a warning.
 *
 * The one difference is that it is present on every X page, not only For You,
 * because this is where your tags and your daily limit live: tying it to For
 * You would mean the only way to switch a tag back on is to be standing on the
 * page it affects.
 */

const BAR_ID = "myx-bar";

let barEl = null;
let statusEl = null;
let tagsEl = null;
let dismissEl = null;
let budgetEl = null;
let pending = null; /* a message that arrived before the bar existed */

function build() {
  if (document.getElementById(BAR_ID)) return;

  barEl = document.createElement("div");
  barEl.id = BAR_ID;

  const name = document.createElement("span");
  name.className = "myx-bar__name";
  name.textContent = "my-x";

  statusEl = document.createElement("span");
  statusEl.className = "myx-bar__status";

  tagsEl = document.createElement("span");
  tagsEl.className = "myx-bar__tags";

  dismissEl = document.createElement("button");
  dismissEl.className = "myx-bar__dismiss";
  dismissEl.textContent = "×";
  dismissEl.title = "Dismiss this message";
  dismissEl.hidden = true;
  dismissEl.addEventListener("click", () => MyX.bar.clear());

  budgetEl = buildBudget();

  barEl.append(name, statusEl, tagsEl, dismissEl, budgetEl);
  document.body.append(barEl);

  makeRoom();

  applyTheme();

  /* The bar can be built either side of the storage read, so state it now. */
  MyX.bar.refreshBudget();
  MyX.bar.refreshTags();

  if (pending) {
    MyX.bar.say(pending.text, pending.isError);
    pending = null;
  }
}

/*
 * The budget control: "47 / [100] today", where the number is editable.
 *
 * The same control is used by the panel that covers a spent timeline, so
 * there is one place that knows how it works. The caller keeps the element
 * and calls its myxRefresh() to restate the count.
 */
function buildBudget(onLimit) {
  const wrap = document.createElement("span");
  wrap.className = "myx-budget";

  const count = document.createElement("span");
  count.className = "myx-budget__count";

  const field = document.createElement("input");
  field.className = "myx-budget__limit";
  field.type = "number";
  field.min = String(MyX.budget.MIN_LIMIT);
  field.max = String(MyX.budget.MAX_LIMIT);
  field.title = "Posts you allow yourself each day";

  /* On change, not on input: every keystroke would re-tick, and a half-typed
   * "5" on the way to "50" would block the feed under your hands. */
  field.addEventListener("change", () => {
    MyX.budget.setLimit(field.value);
    field.value = String(MyX.budget.limit);
    if (onLimit) onLimit();
  });

  const label = document.createElement("span");
  label.className = "myx-budget__label";
  label.textContent = "today";

  wrap.append(count, field, label);
  wrap.myxRefresh = () => {
    count.textContent = `${MyX.budget.count()} /`;
    if (document.activeElement !== field) {
      field.value = String(MyX.budget.limit);
    }
  };
  return wrap;
}

/*
 * Making room for the bar.
 *
 * bar.css pushes normal flow down, but that does nothing for the things X pins
 * to the top of the viewport: the left nav, the column's tab bar, and the
 * search box. Those have to be pushed down by hand or they sit under the bar.
 *
 * They are found by looking rather than by naming them, because naming them
 * means three deep selectors into markup we do not own, and two of the three
 * have no stable handle at all. Anything pinned at top: 0 in the shallow
 * structure of X's three columns is page chrome and gets moved.
 *
 * The depth limit is what makes this safe as well as cheap: it keeps the scan
 * to about forty elements, and it cannot reach inside a post, so a pinned
 * element within someone's tweet is never touched. X sets no inline `top` on
 * any of them, so there is nothing to fight over.
 */
const CHROME_ROOTS = [
  'header[role="banner"]',
  '[data-testid="primaryColumn"]',
  '[data-testid="sidebarColumn"]',
];
const CHROME_DEPTH = 6;

/*
 * Run on every tick: X rebuilds its columns on every view change, so the
 * elements pushed down last time may not be the ones on the page now.
 */
function makeRoom() {
  for (const sel of CHROME_ROOTS) {
    const root = document.querySelector(sel);
    if (!root) continue;

    let level = [root];
    for (let depth = 0; level.length && depth <= CHROME_DEPTH; depth++) {
      const next = [];
      for (const el of level) {
        const cs = getComputedStyle(el);
        const pinned =
          (cs.position === "fixed" || cs.position === "sticky") &&
          (cs.top === "0px" || el.style.top);

        if (pinned && el.getBoundingClientRect().height >= 5) {
          el.style.top = "var(--myx-bar-h)";
          continue; /* its children are inside a bar we have already moved */
        }
        next.push(...el.children);
      }
      level = next;
    }
  }
}

/*
 * X has three themes and marks none of them in a way CSS can hang off, so read
 * the page's own background and follow it. Re-read on every tick, since the
 * theme can be changed without a reload.
 */
function applyTheme() {
  if (!barEl) return;
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/\d+/g);
  const light = m ? Number(m[0]) + Number(m[1]) + Number(m[2]) > 383 : true;
  barEl.dataset.myxTheme = light ? "light" : "dark";
}

MyX.bar = {
  /*
   * Only the most recent message is shown. Everything the pass reports is a
   * running status ("hidden 23 posts"), so a queue would just show stale
   * counts.
   */
  say(text, isError) {
    if (!statusEl) {
      pending = { text, isError };
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.toggle("myx-bar__status--error", Boolean(isError));

    /* Only a problem is worth dismissing. The ordinary status is replaced by
     * the next pass anyway, so a button to clear it would achieve nothing. */
    dismissEl.hidden = !isError;
  },

  clear() {
    if (!statusEl) {
      pending = null;
      return;
    }
    statusEl.textContent = "";
    statusEl.classList.remove("myx-bar__status--error");
    dismissEl.hidden = true;
  },

  /*
   * The tag manager: one chip per tag, dim when the tag is switched off and
   * bright when it is showing. This is the whole settings surface.
   */
  refreshTags() {
    if (!tagsEl) return;
    tagsEl.textContent = "";

    for (const tag of MyX.tags.allTags()) {
      const off = MyX.tags.isTagHidden(tag);

      const chip = document.createElement("button");
      chip.className = "myx-chip";
      chip.classList.toggle("myx-chip--off", off);
      chip.textContent = tag;
      chip.title = off ? `Show ${tag} again` : `Hide ${tag}`;
      chip.addEventListener("click", () => {
        MyX.tags.setTagHidden(tag, !off);
        MyX.bar.refreshTags();
        MyX.tickNow();
      });

      tagsEl.append(chip);
    }
  },

  /*
   * Called both when the bar is built and when the stored state arrives,
   * whichever order those happen in.
   */
  refreshBudget() {
    if (budgetEl) budgetEl.myxRefresh();
  },

  /* For the panel over a spent timeline, in home.js. */
  buildBudget,
};

build();

MyX.onTick(() => {
  applyTheme();
  makeRoom();
});
