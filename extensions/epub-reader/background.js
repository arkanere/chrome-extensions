// background/interceptor — detect EPUB navigation and route it to our viewer.
// Knows nothing about book content, speech or UI (see the module map in planned-architecture.md).
//
// Copied from pdf-reader with the regex and the menu title changed. The difference
// that matters is one of emphasis, not code: Chrome downloads .epub rather than
// navigating to it, so interception is the bonus here and the file picker is the
// primary way in (open question 3).

const RULE_IDS = [1, 2];

function viewerUrlFor(src) {
  // src is appended raw. viewer.js reads everything after "?src=" literally, so a
  // query string inside the book's URL survives without needing to be encoded here —
  // declarativeNetRequest cannot URL-encode during substitution.
  return chrome.runtime.getURL("viewer.html") + "?src=" + src;
}

// Interception is best-effort by design. declarativeNetRequest matches on URL only,
// so it cannot see Content-Type and will miss books served from extensionless URLs.
// The action button and context menu below are the guaranteed way in.
async function installRules() {
  const substitution = chrome.runtime.getURL("viewer.html") + "?src=\\0";

  const rules = [
    {
      id: 1,
      priority: 1,
      condition: {
        regexFilter: "^https?://.*\\.epub(\\?.*)?$",
        resourceTypes: ["main_frame"],
      },
      action: {
        type: "redirect",
        redirect: { regexSubstitution: substitution },
      },
    },
    {
      // Open question 3: does DNR fire on file:// at all? Registered separately so a
      // rejection here does not take the http rule down with it.
      id: 2,
      priority: 1,
      condition: {
        regexFilter: "^file://.*\\.epub$",
        resourceTypes: ["main_frame"],
      },
      action: {
        type: "redirect",
        redirect: { regexSubstitution: substitution },
      },
    },
  ];

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: RULE_IDS,
      addRules: rules,
    });
    console.log("[epub-reader] both redirect rules installed");
  } catch (err) {
    console.warn("[epub-reader] full rule set rejected:", err.message);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: RULE_IDS,
      addRules: [rules[0]],
    });
    console.log("[epub-reader] http rule installed, file:// rule rejected");
  }
}

function openViewer(src) {
  if (!src) return;
  chrome.tabs.create({ url: viewerUrlFor(src) });
}

chrome.runtime.onInstalled.addListener(() => {
  installRules();
  chrome.contextMenus.create({
    id: "open-in-epub-reader",
    title: "Open in EPUB Reader",
    contexts: ["link", "page"],
  });
});

chrome.runtime.onStartup.addListener(installRules);

// Manual entry point 1: toolbar button re-opens whatever the current tab is showing.
// This is how a book that interception missed still gets into our viewer.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL(""))) return;
  openViewer(tab.url);
});

// Manual entry point 2: right-click a link, or the page itself.
chrome.contextMenus.onClicked.addListener((info) => {
  openViewer(info.linkUrl || info.pageUrl);
});
