/**
 * Storage. Locally, one JSON file (data/store.json) written atomically; every
 * function is async so a hosted database (Supabase) can replace this file
 * later without the rest of the app changing.
 *
 * Collections: users, checkins, hellos, messages, meetups, blocks, reports,
 * events (organiser-added).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const FILE = process.env.OUTSIDE_STORE || fileURLToPath(new URL("../data/store.json", import.meta.url));
const EMPTY = () => ({ users: {}, checkins: {}, hellos: {}, messages: {}, meetups: {}, blocks: {}, reports: {}, events: {} });

let db = null;
function load() {
  if (db) return db;
  try {
    db = existsSync(FILE) ? { ...EMPTY(), ...JSON.parse(readFileSync(FILE, "utf8")) } : EMPTY();
  } catch {
    db = EMPTY();
  }
  return db;
}

let pending = null;
function save() {
  // Coalesce writes made in the same tick into one.
  if (pending) return pending;
  pending = Promise.resolve().then(() => {
    pending = null;
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, FILE);
  });
  return pending;
}

export const newId = () => randomUUID();

export async function get(collection, id) {
  return load()[collection][id] ?? null;
}

export async function put(collection, record) {
  const rec = { ...record, id: record.id || newId() };
  load()[collection][rec.id] = rec;
  await save();
  return rec;
}

export async function remove(collection, id) {
  delete load()[collection][id];
  await save();
}

export async function list(collection, where = () => true) {
  return Object.values(load()[collection]).filter(where);
}

/** For tests: start from empty. */
export async function reset() {
  db = EMPTY();
  await save();
}
