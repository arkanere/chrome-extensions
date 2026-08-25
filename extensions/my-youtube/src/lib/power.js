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
 * briefly clean while switched off is harmless; the reverse would flash a
 * page we mean to have cleaned.
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
   * Reload rather than flip in place. Taking the attribute off would un-hide
   * everything, but the watch page would keep the player size it measured
   * while the related column was hidden, and switching back on would not
   * re-run the route. A reload gets both right for free, and this is a button
   * you press about twice a year.
   */
  async set(on) {
    await chrome.storage.local.set({ [OFF_KEY]: !on });
    location.reload();
  },
};
