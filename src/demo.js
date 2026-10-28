/**
 * Demo data, clearly labelled: ten demo people with different tastes checked
 * in around one city, a dozen reviews, and one demo venue account. It makes
 * the map glow and "people like you" show something real in the demo video.
 *
 * Every demo record is marked: users carry "Demo · " in their name and
 * demo: true, and every id starts with "demo-", so removeDemo() can take it
 * all away again. Favourites are resolved on live Qloo, like a real sign-up.
 */

import { get, put, list, remove } from "./store.js";
import { findEntity } from "./qloo.js";
import { resolveFavourites } from "./taste.js";
import { likeness } from "./likeness.js";
import { shortName } from "./places.js";
import { cityNamed, cityNear } from "./cities.js";
import { localDay } from "./reviews.js";
import { hashPassword } from "./auth.js";
import { randomBytes } from "node:crypto";

const NAME = "Demo · ";
const DEMO = /^demo-/;
const COLLECTIONS = ["users", "checkins", "hellos", "messages", "meetups", "blocks", "reports", "events", "reviews"];

/** The venues demo people go to, by the name Qloo knows them by. */
export const DEMO_VENUES = ["Ronnie Scott's", "Jazz Cafe Camden", "Dishoom Shoreditch", "XOYO", "Sketch", "Brixton Jamm"];
export const DEMO_ORGANISER_VENUE = "Jazz Cafe Camden";

const av = (skin, hair, hairColour, outfit, extras = []) => ({ skin, hair, hairColour, outfit, extras });

export const DEMO_USERS = [
  { slug: "amara", firstName: `${NAME}Amara`, taste: [["artist", "Burna Boy"], ["artist", "Tems"], ["artist", "Wizkid"]], venue: "Jazz Cafe Camden", visibility: "everyone",
    avatar: av("#8d5524", "braids", "#1a1110", "#ff5e4d", ["earrings"]), review: [5, "Afrobeats night was packed and the sound was perfect."] },
  { slug: "tolu", firstName: `${NAME}Tolu`, taste: [["artist", "Tems"], ["artist", "Burna Boy"], ["artist", "Jorja Smith"]], venue: "Jazz Cafe Camden", visibility: "everyone",
    avatar: av("#5c3317", "lowcut", "#1a1110", "#00d285", ["beard"]), review: [4, "Great crowd, got there early for a spot upstairs."] },
  { slug: "kofi", firstName: `${NAME}Kofi`, taste: [["artist", "Ezra Collective"], ["artist", "Kamasi Washington"], ["artist", "Tems"]], venue: "Jazz Cafe Camden", visibility: "everyone",
    avatar: av("#3b2219", "locs", "#1a1110", "#6b7cff", ["glasses"]), review: [5, "The horns. Honestly the best live room in Camden."] },
  { slug: "nina", firstName: `${NAME}Nina`, taste: [["artist", "Kamasi Washington"], ["artist", "Ezra Collective"]], venue: "Ronnie Scott's", visibility: "everyone",
    avatar: av("#e0ac69", "bun", "#3b2414", "#1b2230"), review: [5, "Late show was intimate and the band was on fire."] },
  { slug: "sam", firstName: `${NAME}Sam`, taste: [["artist", "Ezra Collective"], ["artist", "SZA"]], venue: "Ronnie Scott's", visibility: "strong",
    avatar: av("#c68642", "short", "#6b4423", "#f3c68f"), review: [4, "Pricey drinks but you forget once the music starts."] },
  { slug: "olly", firstName: `${NAME}Olly`, taste: [["artist", "Arctic Monkeys"]], venue: "Ronnie Scott's", visibility: "everyone",
    avatar: av("#f1c27d", "long", "#d9b26f", "#f8fafc", ["cap"]), review: [3, "Not my usual thing, but a proper night out."] },
  { slug: "maya", firstName: `${NAME}Maya`, taste: [["artist", "SZA"], ["artist", "Jorja Smith"]], venue: "Sketch", visibility: "everyone",
    avatar: av("#8d5524", "afro", "#1a1110", "#e84393", ["earrings"]), review: [4, "Pink room for cocktails, then on somewhere louder."],
    extra: [["Jazz Cafe Camden", 5, "Soulful singers all night, felt like a Jorja set."]] },
  { slug: "jay", firstName: `${NAME}Jay`, taste: [["artist", "Stormzy"], ["artist", "Dave"]], venue: "Dishoom Shoreditch", visibility: "everyone",
    avatar: av("#5c3317", "lowcut", "#1a1110", "#1b2230", ["cap"]), review: [5, "Black daal before a night out. Queue moves fast."],
    extra: [["Jazz Cafe Camden", 4, "Came for a grime set, stayed for the band after."]] },
  { slug: "dele", firstName: `${NAME}Dele`, taste: [["artist", "Dave"], ["artist", "Stormzy"], ["artist", "Burna Boy"]], venue: "XOYO", visibility: "everyone",
    avatar: av("#3b2219", "afro", "#1a1110", "#00d285"), review: [4, "Loud, sweaty, exactly right."] },
  { slug: "lena", firstName: `${NAME}Lena`, taste: [["artist", "Fred again.."], ["artist", "Peggy Gou"]], venue: "Brixton Jamm", visibility: "everyone",
    avatar: av("#f1c27d", "short", "#c0392b", "#6b7cff", ["glasses"]), review: [4, "Garden was buzzing, house all night."] },
];

const userId = (slug) => `demo-${slug}`;
const checkinId = (slug) => `demo-${slug}-checkin`;

/** Find each demo venue on Qloo, in the city. Throws, naming any it can't find. */
export async function resolveVenues(names, city) {
  const out = {}, missing = [];
  for (const n of names) {
    const e = await findEntity(n, "urn:entity:place", { city: city.name });
    if (!e?.location || cityNear(e.location)?.name !== city.name) { missing.push(n); continue; }
    out[n] = { id: e.entity_id, name: shortName(e.name), location: { lat: e.location.lat, lon: e.location.lon } };
  }
  if (missing.length) throw new Error(`Qloo couldn't place these demo venues in ${city.name}: ${missing.join(", ")}`);
  return out;
}

function checkinFor(user, venue, city, at) {
  return {
    id: checkinId(user.id.replace(DEMO, "")),
    userId: user.id,
    venueId: venue.id,
    venueName: venue.name,
    venueLocation: venue.location,
    city: city.name,
    at: at.toISOString(),
    // Demo people stay "out" for 26 hours, so the daily renew always overlaps: judges in any time zone see them.
    expiresAt: new Date(at.getTime() + 26 * 3600_000).toISOString(),
    demo: true,
  };
}

/**
 * Create (or refresh) every demo record. Running it twice gives the same
 * records. Returns counts and the pairwise match matrix, for tuning LIKE_YOU.
 */
export async function seedDemo({ cityName = "London", now = new Date() } = {}) {
  const city = cityNamed(cityName);
  if (!city) throw new Error(`Unknown city: ${cityName}`);
  const venues = await resolveVenues([...new Set([...DEMO_VENUES, ...DEMO_USERS.map((u) => u.venue)])], city);

  // Demo accounts sign in like anyone else: DEMO_PASSWORD when set, else a random one nobody knows.
  const fromEnv = (process.env.DEMO_PASSWORD || "").length >= 8;
  const password = fromEnv ? process.env.DEMO_PASSWORD : randomBytes(18).toString("base64url");

  const users = [], missing = {};
  for (const d of DEMO_USERS) {
    const { favourites, missing: miss } = await resolveFavourites(d.taste.map(([type, name]) => ({ type, name })));
    if (miss.length) missing[d.slug] = miss;
    const prev = await get("users", userId(d.slug));
    const u = await put("users", {
      id: userId(d.slug),
      email: `${d.slug}@demo.outside.invalid`,
      passwordHash: hashPassword(password),
      firstName: d.firstName,
      homeCity: city.name,
      city: city.name,
      verified: false,
      favourites,
      avatar: d.avatar,
      visibility: d.visibility,
      demo: true,
      demoVenue: venues[d.venue],
      createdAt: prev?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    });
    users.push({ d, u });
  }

  // Fresh check-ins, a few minutes apart so the room fills up naturally.
  let checkins = 0;
  for (const [i, { d, u }] of users.entries()) {
    await put("checkins", checkinFor(u, venues[d.venue], city, new Date(now.getTime() - (i * 7 + 5) * 60_000)));
    checkins++;
  }

  // Reviews with fixed ids.
  const day = localDay(now, city.tz);
  let reviews = 0;
  for (const { d, u } of users) {
    const rows = [[d.venue, ...d.review], ...(d.extra || [])];
    for (const [venueName, stars, note] of rows) {
      const v = venues[venueName];
      await put("reviews", { id: `demo-${d.slug}|${v.id}`, userId: u.id, placeId: v.id, placeName: v.name, city: city.name, stars, note, day, at: now.toISOString(), demo: true });
      reviews++;
    }
  }

  const venue = venues[DEMO_ORGANISER_VENUE];
  const prevOrg = await get("users", "demo-venue");
  await put("users", {
    id: "demo-venue",
    email: "venue@demo.outside.invalid",
    passwordHash: hashPassword(password),
    firstName: `${NAME}${venue.name}`,
    homeCity: city.name,
    city: city.name,
    verified: false,
    favourites: [],
    avatar: null,
    visibility: "nobody",
    role: "organiser",
    venueId: venue.id,
    venueName: venue.name,
    venueLocation: venue.location,
    venueCity: city.name,
    demo: true,
    createdAt: prevOrg?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  });

  const matrix = await matchMatrix(users.map((x) => x.u), city.name);
  return { city: city.name, password: fromEnv ? "set from DEMO_PASSWORD" : "random", users: users.length, organisers: 1, checkins, reviews, venues: Object.fromEntries(Object.entries(venues).map(([k, v]) => [k, v.id])), missing, matrix };
}

/** Pairwise likeness between demo users: { slugs, rows[i][j] }. */
export async function matchMatrix(users, cityName) {
  const slugs = users.map((u) => u.id.replace(DEMO, ""));
  const rows = users.map(() => users.map(() => null));
  for (let i = 0; i < users.length; i++) {
    rows[i][i] = 100;
    for (let j = i + 1; j < users.length; j++) {
      const { match } = await likeness(users[i], users[j], cityName);
      rows[i][j] = rows[j][i] = match;
    }
  }
  return { slugs, rows };
}

/** Check every demo person back in at their venue, until 06:00 local. */
export async function renewDemoCheckins(now = new Date()) {
  const demoUsers = await list("users", (u) => u.demo === true && u.role !== "organiser" && u.demoVenue?.id, { demo: true });
  let renewed = 0;
  for (const [i, u] of demoUsers.entries()) {
    const city = cityNamed(u.city) || cityNear(u.demoVenue.location);
    if (!city) continue;
    await put("checkins", checkinFor(u, u.demoVenue, city, new Date(now.getTime() - (i * 7 + 5) * 60_000)));
    renewed++;
  }
  return renewed;
}

const isDemoRecord = (c, r) =>
  ["id", "userId", "from", "to", "by", "who"].some((k) => typeof r[k] === "string" && DEMO.test(r[k]))
  || (Array.isArray(r.users) && r.users.some((x) => DEMO.test(String(x))))
  || (c === "reviews" && r.demo === true);

/** Delete every demo record. Real people's records are never touched. */
export async function removeDemo() {
  const removed = {};
  for (const c of COLLECTIONS) {
    const rows = await list(c, (r) => isDemoRecord(c, r));
    for (const r of rows) await remove(c, r.id);
    if (rows.length) removed[c] = rows.length;
  }
  return removed;
}

/** The match matrix as text, for the seed script. */
export function formatMatrix({ slugs, rows }) {
  const w = Math.max(...slugs.map((s) => s.length), 4);
  const head = " ".repeat(w + 1) + slugs.map((s) => s.slice(0, 5).padStart(6)).join("");
  const lines = rows.map((r, i) => slugs[i].padEnd(w + 1) + r.map((m) => String(m ?? "-").padStart(6)).join(""));
  return [head, ...lines].join("\n");
}
