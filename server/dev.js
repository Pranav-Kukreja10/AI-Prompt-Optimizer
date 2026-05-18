/**
 * server/dev.js — AI Middleware local dev server
 *
 * Features
 * ─────────
 *  • Serves the entire project root (ai-middleware/) on http://localhost:3000
 *  • Correct MIME types for .html .css .js
 *  • File-watcher with live-reload via Server-Sent Events (no WS dependency)
 *  • No npm install needed — pure Node.js built-ins only (fs, http, path)
 *
 * Usage
 * ─────
 *  cd ai-middleware
 *  node server/dev.js
 *
 *  Then open http://localhost:3000 in your browser.
 *  Edit any file → browser reloads automatically.
 */

"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT ?? "3000", 10);
const ROOT    = path.resolve(__dirname, ".."); // project root = ai-middleware/
const RELOAD_PATH = "/__reload";               // SSE endpoint

// ── MIME map ──────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
};

// ── SSE clients (live-reload subscribers) ────────────────────
const clients = new Set();

function broadcast() {
  for (const res of clients) {
    try { res.write("data: reload\n\n"); } catch (_) {}
  }
}

// ── File watcher ─────────────────────────────────────────────
// Watch all .html / .css / .js files recursively using Node's
// built-in fs.watch (no chokidar needed).
function watchDir(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      watchDir(full);
      fs.watch(full, { persistent: false }, debounce(broadcast, 80));
    }
  });
  fs.watch(dir, { persistent: false }, debounce(broadcast, 80));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

watchDir(ROOT);

// ── HTTP server ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0]; // strip query string

  // ── SSE live-reload endpoint ──────────────────────────────
  if (url === RELOAD_PATH) {
    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // ── Resolve file path ──────────────────────────────────────
  let filePath = path.join(ROOT, url === "/" ? "/index.html" : url);

  // Directory → serve its index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  // 404
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`404 — Not found: ${url}`);
    return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(filePath);

  // Inject live-reload SSE snippet into every HTML response
  let body = data;
  if (ext === ".html") {
    const snippet = `
<script>
/* dev-server live-reload */
(function(){
  const es = new EventSource('${RELOAD_PATH}');
  es.onmessage = () => location.reload();
  es.onerror   = () => setTimeout(() => location.reload(), 1000);
})();
</script>`;
    body = Buffer.from(data.toString().replace("</body>", snippet + "\n</body>"));
  }

  res.writeHead(200, {
    "Content-Type":  mime,
    "Cache-Control": "no-cache",
    "Content-Length": body.length,
  });
  res.end(body);
});

server.listen(PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────┐`);
  console.log(`  │  AI Middleware — Dev Server              │`);
  console.log(`  │                                          │`);
  console.log(`  │  Local:  http://localhost:${PORT}           │`);
  console.log(`  │                                          │`);
  console.log(`  │  Watching for changes…  (Ctrl+C to stop) │`);
  console.log(`  └─────────────────────────────────────────┘\n`);
});