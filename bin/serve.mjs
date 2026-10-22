// Local server: `npm start`, then http://localhost:3088
import { createServer } from "node:http";
import { handle } from "../src/router.js";

const port = Number(process.env.PORT) || 3088;
createServer((req, res) => {
  if (req.url.startsWith("/api/")) return handle(req, res);
  res.statusCode = 404;
  res.end("Outside API. Try /api/health");
}).listen(port, () => console.log(`Outside API on http://localhost:${port}`));
