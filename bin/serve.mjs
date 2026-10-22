// Local server: `npm start`, then http://localhost:3088
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, extname } from "node:path";
import { handle } from "../src/router.js";

const port = Number(process.env.PORT) || 3088;
const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) return handle(req, res);
  const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  // Clean URLs: /taste serves taste.html.
  const clean = !extname(path) && path !== "/" ? `${path}.html` : path;
  const file = normalize(join(PUBLIC, clean.endsWith("/") ? `${clean}index.html` : clean));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    // Unknown paths fall back to the app shell, so /tonight etc. still load.
    try {
      res.writeHead(200, { "content-type": TYPES[".html"] }).end(await readFile(join(PUBLIC, "index.html")));
    } catch {
      res.writeHead(404).end("Not found");
    }
  }
}).listen(port, () => console.log(`Outside on http://localhost:${port}`));
