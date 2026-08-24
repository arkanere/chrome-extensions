/*
 * TEMPORARY. A one-time restore of the tags lost on 2026-08-25, recovered
 * from Chrome's LevelDB write-ahead log.
 *
 * Merges: an account you have tagged since keeps its tags, and nothing here
 * overwrites anything. Delete this file and its manifest entry once it has
 * run.
 */

const RECOVERED = {
  "abhijeet_dipke": [
    "politics"
  ],
  "aisa_official_": [
    "politics"
  ],
  "ani": [
    "politics"
  ],
  "arvindkejriwal": [
    "politics"
  ],
  "ashutoshranka": [
    "politics"
  ],
  "b50": [
    "finance"
  ],
  "cjp_for_india": [
    "politics"
  ],
  "cockroachisback": [
    "politics"
  ],
  "dhh": [
    "tech"
  ],
  "itstarh": [
    "finance"
  ],
  "levelsio": [
    "tech"
  ],
  "manujosephsan": [
    "politics"
  ],
  "mnshap": [
    "politics"
  ],
  "neha_aisa": [
    "politics"
  ],
  "niraj_shah": [
    "finance"
  ],
  "nycmayor": [
    "politics"
  ],
  "pidotdev": [
    "tech"
  ],
  "rauchg": [
    "tech"
  ],
  "sardesairajdeep": [
    "politics"
  ],
  "sauravdassss": [
    "politics"
  ],
  "sharma_views": [
    "politics"
  ],
  "sksharmamumbai": [
    "politics"
  ],
  "soicfinance": [
    "finance"
  ],
  "sveltesociety": [
    "tech"
  ],
  "thewire_in": [
    "politics"
  ],
  "tobi": [
    "tech"
  ],
  "unclebobmartin": [
    "tech"
  ],
  "vatsal_sanghvi": [
    "tech"
  ],
  "whattalawyer": [
    "politics"
  ]
};

const RECOVERED_HIDDEN = ["politics", "finance", "tech"];
const RESTORE_FLAG = "restored-2026-08-25";

chrome.storage.local.get([RESTORE_FLAG, "tags", "hidden"], (s) => {
  if (s[RESTORE_FLAG]) return;

  const tags = s.tags || {};
  for (const [handle, list] of Object.entries(RECOVERED)) {
    const merged = new Set([...(tags[handle] || []), ...list]);
    tags[handle] = [...merged];
  }

  const hidden = [...new Set([...(s.hidden || []), ...RECOVERED_HIDDEN])];

  chrome.storage.local.set({ tags, hidden, [RESTORE_FLAG]: true }, () => {
    console.log("[my-x] restored", Object.keys(RECOVERED).length, "tagged accounts");
  });
});
