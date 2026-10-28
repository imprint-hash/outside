/**
 * Guests: open the link and you're in, no sign-up. A guest is a real user
 * record marked guest: true and demo: true, in London, staying at The Hoxton
 * Shoreditch, with a ready-made taste (Burna Boy, Tems, Ezra Collective,
 * Dishoom). Like demo people, guests carry the Demo tag and count as demo.
 *
 * The template's Qloo look-ups happen once and are kept in the store, so a
 * new guest costs no Qloo calls. Taste profiles are keyed by city and
 * favourite ids (likeness.js), so every guest shares one profile too.
 *
 * Guests older than 48 hours are deleted by the daily demo cron, with
 * everything that points at them by exact id.
 */

import { randomUUID, randomInt } from "node:crypto";
import { get, put, list, remove } from "./store.js";
import { resolveFavourites } from "./taste.js";
import { resolveOrigin } from "./places.js";
import { AVATAR_OPTIONS } from "./avatar.js";
import { issueToken, selfView } from "./auth.js";
import { HttpError } from "./http.js";

export const GUEST_TEMPLATE = {
  id: "guest-london",
  city: "London",
  stay: "The Hoxton Shoreditch",
  taste: [{ type: "artist", name: "Burna Boy" }, { type: "artist", name: "Tems" }, { type: "artist", name: "Ezra Collective" }, { type: "place", name: "Dishoom Shoreditch" }],
};
// Where The Hoxton Shoreditch is, if Qloo can't be asked right now. Not stored, so the next call tries again.
const STAY_FALLBACK = { lat: 51.5255, lon: -0.0776, label: "The Hoxton, Shoreditch" };
const GUEST_ID = /^guest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isGuestId = (id) => typeof id === "string" && GUEST_ID.test(id);
export const GUEST_MAX_AGE_MS = 48 * 3600_000;

/* ---------- the template, resolved once ---------- */

let template = null, building = null;

async function buildTemplate() {
  const stored = await get("templates", GUEST_TEMPLATE.id).catch(() => null);
  if (stored?.favourites?.length && stored.stay) return stored;
  const { favourites } = await resolveFavourites(GUEST_TEMPLATE.taste);
  if (!favourites.length) throw new HttpError("We couldn't set up a guest right now. Please try again in a moment.", 503);
  let stay = null;
  try {
    const p = await resolveOrigin(GUEST_TEMPLATE.stay, GUEST_TEMPLATE.city);
    stay = { lat: p.lat, lon: p.lon, label: String(p.label || GUEST_TEMPLATE.stay).slice(0, 80) };
  } catch { /* use the fallback below, and don't keep it */ }
  const rec = { id: GUEST_TEMPLATE.id, city: GUEST_TEMPLATE.city, favourites, stay: stay || STAY_FALLBACK, builtAt: new Date().toISOString() };
  if (stay) await put("templates", rec).catch(() => {});
  return rec;
}

/** The guest template: from memory, else the store, else Qloo (once, shared by callers at the same moment). */
export async function guestTemplate() {
  if (template) return template;
  building ||= buildTemplate().then((t) => { if (t.stay !== STAY_FALLBACK) template = t; return t; }).finally(() => { building = null; });
  return building;
}

/** For tests: forget the template held in memory. */
export const forgetTemplate = () => { template = null; building = null; };

/* ---------- rate limit, per IP, in memory ---------- */

const hits = new Map();
export const GUESTS_PER_HOUR = 20;

export function clientIp(req) {
  const h = req.headers || {};
  const first = (v) => String(v || "").split(",")[0].trim();
  return first(h["x-vercel-forwarded-for"]) || first(h["x-real-ip"]) || first(h["x-forwarded-for"]) || req.socket?.remoteAddress || "unknown";
}

/** Throws 429 when `key` has made `max` calls in the last hour. */
export function rateLimit(key, max = GUESTS_PER_HOUR, now = Date.now()) {
  const recent = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= max) throw new HttpError("Lots of guests from here in the last hour. Try again later, or sign up.", 429);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
}

/** For tests: forget the rate limit. */
export const forgetHits = () => hits.clear();

/* ---------- making a guest ---------- */

const pick = (xs) => xs[randomInt(xs.length)];
const randomAvatar = () => ({
  skin: pick(AVATAR_OPTIONS.skin),
  hair: pick(AVATAR_OPTIONS.hair),
  hairColour: pick(AVATAR_OPTIONS.hairColour),
  outfit: pick(AVATAR_OPTIONS.outfit),
  extras: AVATAR_OPTIONS.extras.filter(() => randomInt(4) === 0).sort(),
});

export async function createGuest(now = new Date()) {
  const t = await guestTemplate();
  const user = await put("users", {
    id: `guest-${randomUUID()}`,
    email: null,
    passwordHash: null,
    firstName: "Guest",
    homeCity: null,
    city: t.city,
    stay: t.stay,
    verified: false,
    favourites: t.favourites,
    avatar: randomAvatar(),
    visibility: "everyone",
    guest: true,
    demo: true,
    createdAt: now.toISOString(),
  });
  return { token: issueToken(user.id, now.getTime()), user: selfView(user) };
}

/* ---------- clean-up ---------- */

/** Delete records in `c` that `mine` matches, using `hint` to narrow the read. */
async function removeWhere(c, hint, mine) {
  const rows = await list(c, mine, hint);
  for (const r of rows) await remove(c, r.id);
  return rows.length;
}

/** Delete one guest and everything that points at them, by exact id. Refuses anyone who isn't a guest. */
export async function removeGuest(id) {
  if (!isGuestId(id)) throw new Error(`Refusing to remove a non-guest id: ${String(id).slice(0, 60)}`);
  const u = await get("users", id);
  if (!u) return null;
  if (u.guest !== true || u.id !== id) throw new Error(`Refusing to remove ${id}: not a guest.`);
  const out = {};
  const add = (k, n) => { if (n) out[k] = (out[k] || 0) + n; };
  add("checkins", await removeWhere("checkins", { userId: id }, (r) => r.userId === id));
  add("reviews", await removeWhere("reviews", { userId: id }, (r) => r.userId === id));
  const hellos = [...await list("hellos", (h) => h.from === id, { from: id }), ...await list("hellos", (h) => h.to === id, { to: id })];
  for (const h of hellos) {
    if (!h.id) continue;
    add("messages", await removeWhere("messages", { helloId: h.id }, (m) => m.helloId === h.id));
    add("meetups", await removeWhere("meetups", { helloId: h.id }, (m) => m.helloId === h.id));
  }
  add("messages", await removeWhere("messages", { from: id }, (m) => m.from === id));
  for (const h of hellos) if (h.id) await remove("hellos", h.id);
  add("hellos", hellos.length);
  add("blocks", await removeWhere("blocks", { by: id }, (b) => b.by === id));
  add("blocks", await removeWhere("blocks", { who: id }, (b) => b.who === id));
  await remove("users", id);
  add("users", 1);
  return out;
}

/** Delete every guest older than 48 hours. Returns totals per collection. */
export async function removeOldGuests(now = new Date()) {
  const old = await list("users", (u) => u.guest === true && isGuestId(u.id) && now - new Date(u.createdAt || 0) > GUEST_MAX_AGE_MS, { guest: true });
  const totals = {};
  for (const u of old) {
    const r = await removeGuest(u.id);
    for (const [k, n] of Object.entries(r || {})) totals[k] = (totals[k] || 0) + n;
  }
  return totals;
}
