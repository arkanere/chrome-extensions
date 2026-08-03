// Toolbar click → inject the reader into the active tab. Re-running the
// content script on a tab where it's already loaded toggles the overlay
// (content.js guards with a window flag), so one handler covers open and close.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:/.test(tab.url ?? "")) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/Readability.js", "content.js"],
    });
  } catch (e) {
    // Pages we can't inject into (Chrome Web Store, PDFs, etc.) — nothing to do.
    console.warn("Reading Mode: cannot run on this page.", e);
  }
});
