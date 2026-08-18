/*
 * The off switch.
 *
 * Chrome does not let an extension disable itself — chrome.management refuses
 * to act on the calling extension — so "off" here means the extension stands
 * down on the page: clean.css stops hiding anything and no page module runs.
 * YouTube is then exactly as it ships. The bar itself stays, otherwise there
 * would be nothing left to switch it back on with.
 *
 * The state is a single flag in chrome.storage.local, so it holds across tabs
 * and restarts.
 *
 * clean.css hangs off data-myyt="on" on <html>. Reading storage is async but
 * hiding must be in place before first paint, so the attribute is set
 * synchronously here and only taken off again if storage says otherwise. Being
 * briefly clean while switched off is harmless; the reverse would flash the
 * homepage grid at you.
 */

const OFF_KEY = "disabled";

let enabled = true;

document.documentElement.dataset.myyt = "on";

MyYT.power = {
  get enabled() {
    return enabled;
  },

  async load() {
    const stored = await chrome.storage.local.get(OFF_KEY);
    enabled = !stored[OFF_KEY];
    if (!enabled) delete document.documentElement.dataset.myyt;
    MyYT.bar.refreshPower();
    return enabled;
  },

  /*
   * Reload rather than undo. Switching off mid-session would mean putting back
   * every card subs.js moved and every class it stamped; switching on would
   * mean rebuilding from a grid we never watched. A reload gets both for free,
   * and this is a button you press about twice a year.
   */
  async set(on) {
    await chrome.storage.local.set({ [OFF_KEY]: !on });
    location.reload();
  },
};
