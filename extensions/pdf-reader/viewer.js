// Wiring only. As modules land in later phases this file builds them and connects
// them together; it should never grow logic of its own.

const logBody = document.getElementById("log-body");
const srcLine = document.getElementById("src-line");

function log(msg) {
  logBody.textContent += msg + "\n";
}

// The interceptor appends the original URL raw, so take everything after "?src="
// literally rather than through URLSearchParams — a query string inside the PDF URL
// would otherwise be split at its first "&".
function sourceUrl() {
  const marker = "?src=";
  const at = location.href.indexOf(marker);
  return at === -1 ? null : location.href.slice(at + marker.length);
}

const src = sourceUrl();

if (src) {
  srcLine.classList.remove("empty");
  srcLine.textContent = src;
  log("arrived with source: " + src);
  log("(phase 1: URL captured, rendering lands in phase 2)");
} else {
  log("opened with no source. Use the file picker, the toolbar button on a PDF tab,");
  log("or right-click a PDF link and choose \"Open in PDF Reader\".");
}

document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  srcLine.classList.remove("empty");
  srcLine.textContent = file.name;

  const buf = await file.arrayBuffer();
  log(`picked local file: ${file.name}`);
  log(`  type: ${file.type || "unknown"}`);
  log(`  bytes: ${buf.byteLength.toLocaleString()}`);
});
