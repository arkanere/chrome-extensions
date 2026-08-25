/*
 * The extension's own bar across the top of YouTube.
 *
 * A strip that says the extension is here, and carries the off switch. It is
 * injected into YouTube's page rather than owning the document, so it also has
 * to push YouTube's masthead down (see bar.css).
 *
 * The bar shows no status: everything the extension does is static hiding, so
 * there is nothing running that could have something to report.
 */

const BAR_ID = "myyt-bar";

let barEl = null;
let powerEl = null;

function build() {
  if (document.getElementById(BAR_ID)) return;

  barEl = document.createElement("div");
  barEl.id = BAR_ID;

  const name = document.createElement("span");
  name.className = "myyt-bar__name";
  name.textContent = "my-youtube";

  powerEl = document.createElement("button");
  powerEl.className = "myyt-bar__power";
  powerEl.addEventListener("click", () => MyYT.power.set(!MyYT.power.enabled));

  barEl.append(name, powerEl);
  document.body.prepend(barEl);

  /* The bar can be built either side of the storage read, so state it now. */
  MyYT.bar.refreshPower();
}

MyYT.bar = {
  /*
   * Called both when the bar is built and when the stored state arrives,
   * whichever order those happen in.
   */
  refreshPower() {
    if (!powerEl) return;
    const on = MyYT.power.enabled;
    powerEl.textContent = on ? "turn off" : "turn on";
    powerEl.title = on
      ? "Leave YouTube as it ships, until you turn this back on"
      : "Switch my-youtube back on";
    barEl.classList.toggle("myyt-bar--off", !on);
  },
};

/* Content scripts run at document_start, so body may not exist yet. */
if (document.body) {
  build();
} else {
  document.addEventListener("DOMContentLoaded", build);
}
