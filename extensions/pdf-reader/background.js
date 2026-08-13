// background/interceptor — detect PDF navigation and route it to our viewer.
// Knows nothing about PDF content, speech or UI (see the module map in architecture.md).

const RULE_IDS = [1, 2];

function viewerUrlFor(src) {
  // src is appended raw. viewer.js reads everything after "?src=" literally, so a
  // query string inside the PDF URL survives without needing to be encoded here —
  // declarativeNetRequest cannot URL-encode during substitution.
  return chrome.runtime.getURL("viewer.html") + "?src=" + src;
}

// Interception is best-effort by design. declarativeNetRequest matches on URL only,
// so it cannot see Content-Type and will miss PDFs served from extensionless URLs.
// The action button and context menu below are the guaranteed way in.
async function installRules() {
  const substitution = chrome.runtime.getURL("viewer.html") + "?src=\\0";

  const rules = [
    {
      id: 1,
      priority: 1,
      condition: {
        regexFilter: "^https?://.*\\.pdf(\\?.*)?$",
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
        regexFilter: "^file://.*\\.pdf$",
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
    console.log("[pdf-reader] both redirect rules installed");
  } catch (err) {
    console.warn("[pdf-reader] full rule set rejected:", err.message);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: RULE_IDS,
      addRules: [rules[0]],
    });
    console.log("[pdf-reader] http rule installed, file:// rule rejected");
  }
}

function openViewer(src) {
  if (!src) return;
  chrome.tabs.create({ url: viewerUrlFor(src) });
}

chrome.runtime.onInstalled.addListener(() => {
  installRules();
  chrome.contextMenus.create({
    id: "open-in-pdf-reader",
    title: "Open in PDF Reader",
    contexts: ["link", "page"],
  });
});

chrome.runtime.onStartup.addListener(installRules);

// Manual entry point 1: toolbar button re-opens whatever the current tab is showing.
// This is how a PDF that interception missed still gets into our viewer.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL(""))) return;
  openViewer(tab.url);
});

// Manual entry point 2: right-click a link, or the page itself.
chrome.contextMenus.onClicked.addListener((info) => {
  openViewer(info.linkUrl || info.pageUrl);
});
