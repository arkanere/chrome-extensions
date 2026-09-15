/*
 * The extension's own bar.
 *
 * Same idea as my-x's and my-youtube's: a strip that says the extension is
 * here. This one filters silently and irreversibly — a post it takes out
 * leaves no gap — so without the bar there is no way to tell "it is working"
 * from "it has broken and the feed is genuinely this quiet".
 *
 * It carries the name and a count, and nothing else. No controls, because
 * there are no settings to control.
 */

const BAR_ID = "myli-bar";

let barEl = null;
let statusEl = null;

function build() {
  if (document.getElementById(BAR_ID)) return;

  barEl = document.createElement("div");
  barEl.id = BAR_ID;

  const name = document.createElement("span");
  name.className = "myli-bar__name";
  name.textContent = "my-linkedin";

  statusEl = document.createElement("span");
  statusEl.className = "myli-bar__status";

  barEl.append(name, statusEl);
  document.body.append(barEl);

  applyTheme();
}

/*
 * LinkedIn marks its dark mode in no way CSS can hang off, so read the page's
 * own background and follow it. Re-read on every tick, since the theme can be
 * changed without a reload.
 */
function applyTheme() {
  if (!barEl) return;
  const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
  const light = m ? Number(m[0]) + Number(m[1]) + Number(m[2]) > 383 : true;
  barEl.dataset.myliTheme = light ? "light" : "dark";
}

MyLI.bar = {
  /*
   * How many posts have been taken out since the page loaded. Counted, rather
   * than left as a bare name, because a number that goes up as you scroll is
   * the proof; a name that is always there proves only that the bar renders.
   *
   * Says nothing at zero: on a page that is not the feed there is nothing to
   * report, and an insistent "hidden 0" would read as a fault.
   */
  setHidden(n) {
    if (!statusEl) return;
    statusEl.textContent = n ? `hidden ${n}` : "";
  },
};

build();

MyLI.onTick(applyTheme);
