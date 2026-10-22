/**
 * The one place Outside talks to Qloo.
 *
 * Every request goes through `qloo()`: the key stays on the server, each call
 * has a time limit, a busy or failing Qloo is retried once, and answers are
 * cached so a page that asks the same thing twice costs one call. A failure is
 * thrown as a QlooError with a plain message, never swallowed into an empty
 * list that would look like "nothing matches you".
 */

import "./env.js";

const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const TIMEOUT_MS = 15_000;
const CACHE_MS = 6 * 3600_000;
const CACHE_MAX = 2000;

export class QlooError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "QlooError";
    this.status = status;
  }
}

const cache = new Map();
export const stats = { calls: 0, cached: 0 };

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

  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600));
    stats.calls++;
    let res;
    try {
      res = await fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      last = new QlooError(/timeout|abort/i.test(err.name + err.message) ? "Qloo took too long to answer." : `Could not reach Qloo: ${err.message}`, 504);
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      remember(url, body);
      return body;
    }
    const text = await res.text().catch(() => "");
    let reason = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      reason = j?.errors?.[0]?.message || j?.error?.reason || j?.error?.message || reason;
    } catch {}
    last = new QlooError(`Qloo answered ${res.status}: ${reason}`, res.status);
    // Only a busy or broken Qloo is worth a second try; a bad request stays bad.
    if (res.status !== 429 && res.status < 500) break;
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
