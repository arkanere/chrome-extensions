/*
 * The off switch.
 *
 * Chrome does not let an extension disable itself, so "off" here means the
 * extension stands down on the page: no pass runs, nothing is hidden, no tag
 * buttons are stamped. X is then exactly as it ships. The bar itself stays,
 * muted, because it is the only way back on.
 *
 * The state is a single flag in chrome.storage.local, so it holds across tabs
 * and restarts.
 *
 * Unlike my-youtube this does not reload on toggle. There is nothing to undo:
 * hiding is one class on a cell, so switching off is one more pass that takes
 * every class off again.
 */

const OFF_KEY = "disabled";

let enabled = true;

MyX.power = {
  get enabled() {
    return enabled;
  },

  async load() {
    const stored = await chrome.storage.local.get(OFF_KEY);
    enabled = !stored[OFF_KEY];
    MyX.bar.refreshPower();
    return enabled;
  },

  async set(on) {
    enabled = on;
    await chrome.storage.local.set({ [OFF_KEY]: !on });
    MyX.bar.refreshPower();
    MyX.tickNow();
  },
};
