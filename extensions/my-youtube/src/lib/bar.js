/*
 * The extension's own bar across the top of YouTube.
 *
 * A strip that says the extension is here, a place for it to tell you
 * something — because a warning that only reaches the console is not a warning
 * — and the whole of the settings surface: your tags as chips, and the daily
 * limit as a number.
 *
 * It is on every YouTube page, not only the homepage. Filtering is a homepage
 * thing, but tying the bar to the homepage would mean the only way to switch a
 * tag back on is to be standing on the page it affects.
 *
 * It is injected into YouTube's page rather than owning the document, so it
 * also has to make room for itself — additively, see bar.css.
 */

const BAR_ID = "myyt-bar";

let barEl = null;
let statusEl = null;
let tagsEl = null;
let dismissEl = null;
let budgetEl = null;
let pendingMessage = null; /* a message that arrived before the bar existed */

function build() {
  if (document.getElementById(BAR_ID)) return;

  barEl = document.createElement("div");
  barEl.id = BAR_ID;

  const name = document.createElement("span");
  name.className = "myyt-bar__name";
  name.textContent = "my-youtube";

  statusEl = document.createElement("span");
  statusEl.className = "myyt-bar__status";

  tagsEl = document.createElement("span");
  tagsEl.className = "myyt-bar__tags";

  dismissEl = document.createElement("button");
  dismissEl.className = "myyt-bar__dismiss";
  dismissEl.textContent = "×";
  dismissEl.title = "Dismiss this message";
  dismissEl.hidden = true;
  dismissEl.addEventListener("click", () => MyYT.bar.clear());

  budgetEl = buildBudget();

  barEl.append(name, statusEl, tagsEl, dismissEl, budgetEl);
  document.body.prepend(barEl);

  /* The bar can be built either side of the storage read, so state it now. */
  MyYT.bar.refreshBudget();
  MyYT.bar.refreshTags();

  if (pendingMessage) {
    MyYT.bar.say(pendingMessage.text, pendingMessage.isError);
    pendingMessage = null;
  }
}

/*
 * The budget control: "47 / [100] today", where the number is editable.
 *
 * The same control is used by the panel over a frozen grid, so there is one
 * place that knows how it works. The caller keeps the element and calls its
 * myytRefresh() to restate the count.
 */
function buildBudget() {
  const wrap = document.createElement("span");
  wrap.className = "myyt-budget";

  const count = document.createElement("span");
  count.className = "myyt-budget__count";

  const field = document.createElement("input");
  field.className = "myyt-budget__limit";
  field.type = "number";
  field.min = String(MyYT.budget.MIN_LIMIT);
  field.max = String(MyYT.budget.MAX_LIMIT);
  field.title = "Videos you allow the homepage to show you each day";

  /* On change, not on input: every keystroke would re-tick, and a half-typed
   * "5" on the way to "50" would freeze the grid under your hands. */
  field.addEventListener("change", () => {
    MyYT.budget.setLimit(field.value);
    field.value = String(MyYT.budget.limit);
  });

  /* YouTube treats bare keys as player shortcuts. */
  field.addEventListener("keydown", (e) => e.stopPropagation());

  const label = document.createElement("span");
  label.className = "myyt-budget__label";
  label.textContent = "today";

  wrap.append(count, field, label);
  wrap.myytRefresh = () => {
    count.textContent = `${MyYT.budget.count()} /`;
    if (document.activeElement !== field) {
      field.value = String(MyYT.budget.limit);
    }
  };
  return wrap;
}

MyYT.bar = {
  /*
   * Only the most recent message is shown. Everything the pass reports is a
   * running status ("hidden 23 videos"), so a queue would just show stale
   * counts.
   */
  say(text, isError) {
    if (!statusEl) {
      pendingMessage = { text, isError };
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.toggle("myyt-bar__status--error", Boolean(isError));

    /* Only a problem is worth dismissing. The ordinary status is replaced by
     * the next pass anyway, so a button to clear it would achieve nothing. */
    dismissEl.hidden = !isError;
  },

  clear() {
    if (!statusEl) {
      pendingMessage = null;
      return;
    }
    statusEl.textContent = "";
    statusEl.classList.remove("myyt-bar__status--error");
    dismissEl.hidden = true;
  },

  /*
   * The tag manager: one chip per tag, dim when the tag is switched off and
   * bright when it is showing. This is the whole settings surface.
   */
  refreshTags() {
    if (!tagsEl) return;
    tagsEl.textContent = "";

    for (const tag of MyYT.tags.allTags()) {
      const off = MyYT.tags.isTagHidden(tag);

      const chip = document.createElement("button");
      chip.className = "myyt-chip";
      chip.classList.toggle("myyt-chip--off", off);
      chip.textContent = tag;
      chip.title = off ? `Show ${tag} again` : `Hide ${tag}`;
      chip.addEventListener("click", () => {
        MyYT.tags.setTagHidden(tag, !off);
        MyYT.bar.refreshTags();
        MyYT.tickNow();
      });

      tagsEl.append(chip);
    }
  },

  /*
   * Called both when the bar is built and when the stored state arrives,
   * whichever order those happen in.
   */
  refreshBudget() {
    if (budgetEl) budgetEl.myytRefresh();
  },

  /* For the panel over a frozen grid, in home.js. */
  buildBudget,
};

/* Content scripts run at document_start, so body may not exist yet. */
if (document.body) {
  build();
} else {
  document.addEventListener("DOMContentLoaded", build);
}
