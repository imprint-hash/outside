/**
 * Storage. Two drivers behind the same small async API:
 *
 * - Supabase (hosted Postgres), when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   are set. One table, `records`, keyed by (collection, id), each record a
 *   JSON document. Row Level Security is on with no policies, so only this
 *   server, with the secret key, can touch it. Talked to over its REST API
 *   with plain fetch: no client library to install.
 * - A local JSON file (data/store.json), for tests and offline work, or
 *   whenever OUTSIDE_STORE names a file.
 *
 * Collections: users, checkins, hellos, messages, meetups, blocks, reports,
 * events (found and organiser-added), reviews, searches (per-city search
 * markers), profiles (cached taste profiles).
 */

import "./env.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const newId = () => randomUUID();

const COLLECTIONS = ["users", "checkins", "hellos", "messages", "meetups", "blocks", "reports", "events", "reviews", "searches", "profiles"];

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

/* ---------- file driver ---------- */

function fileDriver(file) {
  const EMPTY = () => Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
  let db = null;
  const load = () => {
    if (db) return db;
    try {
      db = existsSync(file) ? { ...EMPTY(), ...JSON.parse(readFileSync(file, "utf8")) } : EMPTY();
    } catch {
      db = EMPTY();
    }
    return db;
  };
  let pending = null;
  const save = () => {
    // Coalesce writes made in the same tick into one.
    if (pending) return pending;
    pending = Promise.resolve().then(() => {
      pending = null;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(db));
      renameSync(`${file}.tmp`, file);
    });
    return pending;
  };
  return {
    name: "file",
    get: async (c, id) => load()[c][id] ?? null,
    put: async (c, rec) => ((load()[c][rec.id] = rec), await save(), rec),
    remove: async (c, id) => (delete load()[c][id], await save()),
    all: async (c, match = {}) => Object.values(load()[c]).filter((r) => Object.entries(match).every(([k, v]) => String(r[k]) === String(v))),
    reset: async () => ((db = EMPTY()), await save()),
  };
}

/* ---------- Supabase driver ---------- */

function supabaseDriver(url, key) {
  const base = `${url.replace(/\/$/, "")}/rest/v1/records`;
  const headers = { apikey: key, "content-type": "application/json" };
  // Legacy JWT keys also want an Authorization header; the newer sb_secret_ keys don't.
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;

  async function call(method, query, body, extra = {}) {
    let res;
    try {
      res = await fetch(`${base}?${query}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new StoreError(`The database didn't answer: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (/relation .*records.* does not exist|PGRST205/i.test(text)) throw new StoreError("The database isn't set up yet: run supabase/schema.sql in the Supabase SQL Editor.");
      throw new StoreError(`The database answered ${res.status}: ${text.slice(0, 160)}`);
    }
    // Writes with return=minimal answer 201 with an empty body.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const enc = encodeURIComponent;

  return {
    name: "supabase",
    async get(c, id) {
      const rows = await call("GET", `collection=eq.${enc(c)}&id=eq.${enc(id)}&select=data`);
      return rows[0]?.data ?? null;
    },
    async put(c, rec) {
      await call("POST", "on_conflict=collection,id", { collection: c, id: rec.id, data: rec, updated_at: new Date().toISOString() }, { prefer: "resolution=merge-duplicates,return=minimal" });
      return rec;
    },
    async remove(c, id) {
      await call("DELETE", `collection=eq.${enc(c)}&id=eq.${enc(id)}`, null, { prefer: "return=minimal" });
    },
    async all(c, match = {}) {
      // Equality hints ({ userId: "…" }) are filtered in the database, so a
      // lookup brings back a handful of rows, not the whole collection.
      const filters = Object.entries(match).map(([k, v]) => `&data->>${enc(k)}=eq.${enc(String(v))}`).join("");
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = await call("GET", `collection=eq.${enc(c)}${filters}&select=data&order=id`, null, { range: `${from}-${from + 999}` });
        out.push(...rows.map((r) => r.data));
        if (rows.length < 1000) return out;
      }
    },
    async reset() {
      throw new StoreError("Refusing to wipe the hosted database from code.");
    },
  };
}

/* ---------- pick one ---------- */

const useFile = process.env.OUTSIDE_STORE || !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const driver = useFile
  ? fileDriver(process.env.OUTSIDE_STORE || fileURLToPath(new URL("../data/store.json", import.meta.url)))
  : supabaseDriver(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const storeName = driver.name;

export async function get(collection, id) {
  return driver.get(collection, id);
}

export async function put(collection, record) {
  const rec = { ...record, id: record.id || newId() };
  return driver.put(collection, rec);
}

export async function remove(collection, id) {
  return driver.remove(collection, id);
}

/**
 * Records in a collection that pass `where`. `match` is an optional hint of
 * exact field values ({ userId }) the database can filter on first; `where`
 * still decides, so a hint can only make a lookup faster, never different.
 */
export async function list(collection, where = () => true, match = {}) {
  return (await driver.all(collection, match)).filter(where);
}

/** For tests on the file driver: start from empty. */
export async function reset() {
  return driver.reset();
}
