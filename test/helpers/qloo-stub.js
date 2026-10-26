/**
 * A fake Qloo for offline tests. `handler(path, params)` returns the JSON to
 * answer (or a Promise of it); every call is recorded in `calls`.
 *
 * Set process.env.QLOO_BASE_URL = url and QLOO_API_KEY = "test" BEFORE
 * importing anything from src/, because qloo.js reads the base URL on load.
 */

import { createServer } from "node:http";

export async function startQlooStub(handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://stub");
    const params = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, params });
    try {
      const body = await handler(u.pathname, params);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body ?? {}));
    } catch (err) {
      res.writeHead(err.status || 500, { "content-type": "application/json" }).end(JSON.stringify({ error: err.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((resolve) => server.close(resolve)) };
}
