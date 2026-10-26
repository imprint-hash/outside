/**
 * The one place Outside talks to Qloo.
 *
 * Every request goes through `qloo()`: the key stays on the server, each call
 * has a time limit, at most a few run at once (Qloo rate-limits bursts), a busy
 * Qloo is retried with growing waits, the same question asked twice at once is
 * asked once, and answers are cached: in memory, and in the store so a fresh
 * serverless instance doesn't ask Qloo everything again. A failure is
 * thrown as a QlooError with a plain message, never swallowed into an empty
 * list that would look like "nothing matches you".
 */

import "./env.js";
import { createHash } from "node:crypto";
import { get, put } from "./store.js";

const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const TIMEOUT_MS = 15_000;
const CACHE_MS = 6 * 3600_000;
const CACHE_MAX = 2000;
const MAX_AT_ONCE = 3;
// The store-backed cache is for the real Qloo only; tests point QLOO_BASE_URL at a stub.
const PERSIST = !process.env.QLOO_BASE_URL && process.env.QLOO_PERSIST !== "0";

export class QlooError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "QlooError";
    this.status = status;
  }
}

const cache = new Map();
const inFlight = new Map();
export const stats = { calls: 0, cached: 0 };

let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_AT_ONCE) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

/** GET a Qloo path with query params. Arrays are joined with commas. */
export async function qloo(path, params = {}) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new QlooError("QLOO_API_KEY is not set on the server.", 500);

  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const url = `${BASE}${path}?${q}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    stats.cached++;
    return hit.value;
  }
  if (inFlight.has(url)) return inFlight.get(url);
  const p = fetchQloo(url, key).finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

async function fetchQloo(url, key) {
  const id = PERSIST ? createHash("sha1").update(url).digest("hex") : null;
  if (id) {
    const saved = await get("qcache", id).catch(() => null);
    if (saved && Date.now() - Date.parse(saved.at) < CACHE_MS) {
      stats.cached++;
      remember(url, saved.body);
      return saved.body;
    }
  }
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    stats.calls++;
    let res;
    try {
      res = await slot(() => fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
    } catch (err) {
      last = new QlooError(/timeout|abort/i.test(err.name + err.message) ? "Qloo took too long to answer." : `Could not reach Qloo: ${err.message}`, 504);
      await sleep(600 * (attempt + 1));
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      remember(url, body);
      if (id) put("qcache", { id, at: new Date().toISOString(), body }).catch(() => {});
      return body;
    }
    const text = await res.text().catch(() => "");
    let reason = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      reason = j?.errors?.[0]?.message || j?.error?.reason || j?.error?.message || j?.error_msg || reason;
    } catch {}
    last = res.status === 429
      ? new QlooError("Qloo is busy right now. Give it a few seconds and try again.", 503)
      : new QlooError(`Qloo answered ${res.status}: ${reason}`, res.status);
    // Only a busy or broken Qloo is worth another try; a bad request stays bad.
    if (res.status !== 429 && res.status < 500) break;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 8) * 1000 : 700 * 2 ** attempt + Math.random() * 300);
  }
  throw last;
}

const CITY_WORDS = /\b(lagos|nigeria|london|uk|houston|atlanta|texas|georgia|accra|ghana|new york|nyc)\b/gi;
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Find one entity by name. Qloo's search matches addresses and descriptions
 * too, and adding a city to the query makes it worse ("Quilox Lagos" returns a
 * different bar on the same street). So: search the bare name, then among the
 * results prefer the one whose own name holds the words asked for, in the city
 * asked for ("Quilox" exists in Lagos, Akure and Washington DC). Returns null
 * when Qloo knows nothing by that name.
 */
export async function findEntity(query, type, { city } = {}) {
  const cityHint = city || (String(query).match(CITY_WORDS) || [])[0];
  const bare = String(query).replace(CITY_WORDS, " ").replace(/\s+/g, " ").trim() || String(query);
  const r = await qloo("/search", { query: bare, types: type, take: 8 });
  const found = r.results ?? [];
  if (!found.length) return null;
  const words = norm(bare).split(" ").filter((w) => w.length > 1);
  const inCity = (e) => (cityHint ? norm(`${e.properties?.address || ""} ${e.properties?.geocode?.city || ""} ${e.disambiguation || ""}`).includes(norm(cityHint)) : false);
  const score = (e) => (words.length ? words.filter((w) => norm(e.name).includes(w)).length / words.length : 0) * 2 + (inCity(e) ? 1 : 0);
  let best = found[0], top = score(found[0]);
  for (const e of found.slice(1)) {
    const s = score(e);
    if (s > top) { best = e; top = s; }
  }
  return best;
}

/**
 * Tidy a name Qloo stores with stray capitals: "TEms" -> "Tems". Only the
 * two-capitals-then-lowercase pattern is touched, so "SZA", "AY Makun" and
 * "McDonald's" stay as they are.
 */
export function prettyName(name) {
  return String(name || "").replace(/\b([A-Z])([A-Z])([a-z]{2,})\b/g, (_, a, b, rest) => a + b.toLowerCase() + rest);
}

/** Search several matches for a name, for pickers in the UI. */
export async function searchEntities(query, type, take = 6) {
  const r = await qloo("/search", { query, types: type, take });
  return r.results ?? [];
}

/** Entity insights: the typed recommendation call everything else is built on. */
export async function insights(params) {
  const r = await qloo("/v2/insights", params);
  return r.results ?? {};
}
