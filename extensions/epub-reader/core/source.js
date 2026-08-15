// core/source — a URL or a picked File becomes bytes plus a stable document key.
// Knows nothing about pdf.js or speech.

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// fetch() refuses the file: scheme even with "Allow access to file URLs" granted.
// XMLHttpRequest still honours it, so file:// documents go down this path.
function fetchViaXhr(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => {
      // A file:// read reports status 0 on success.
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) resolve(xhr.response);
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("could not read the file"));
    xhr.send();
  });
}

async function bytesFromUrl(url) {
  if (url.startsWith("file://")) return fetchViaXhr(url);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

// The key is the hash of the bytes, not the URL: it survives a file being moved
// or a signed URL expiring, which is what makes resume-position reliable.
export async function fromUrl(url) {
  const bytes = await bytesFromUrl(url);
  return { bytes, key: await sha256(bytes), label: decodeURIComponent(url.split("/").pop()) || url };
}

export async function fromFile(file) {
  const bytes = await file.arrayBuffer();
  return { bytes, key: await sha256(bytes), label: file.name };
}
