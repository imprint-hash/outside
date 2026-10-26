/**
 * How alike two people are, with taste profiles kept in the store.
 *
 * Building a profile costs four Qloo calls. A serverless function starts cold
 * often, so profiles are saved and reused for a week. The key is a hash of
 * the city and the favourite ids, never a user id, so a stored profile says
 * nothing about who it belongs to, and two people who love the same things
 * share one.
 */

import { createHash } from "node:crypto";
import { get, put } from "./store.js";
import { buildProfile, compareProfiles, matchLine } from "./taste.js";
import { cityOf } from "./cities.js";

const WEEK_MS = 7 * 24 * 3600_000;
const memory = new Map();

// Bump PROFILE_VERSION when what a profile holds changes, so old stored ones are rebuilt.
// v2: city picks are only places inside the city.
const PROFILE_VERSION = "v2";
const keyFor = (cityName, ids) => createHash("sha1").update(`${PROFILE_VERSION}|${cityName}|${ids.join(",")}`).digest("hex");

/** A user's taste profile in a city, or null if they haven't said what they love. */
export async function profileFor(user, cityName = cityOf(user).name) {
  if (!user?.favourites?.length) return null;
  const ids = [...new Set(user.favourites.map((f) => f.id))].sort();
  const key = keyFor(cityName, ids);
  const now = Date.now();

  const inMemory = memory.get(key);
  if (inMemory && now - new Date(inMemory.builtAt) < WEEK_MS) return inMemory;

  const stored = await get("profiles", key).catch(() => null);
  if (stored && now - new Date(stored.builtAt) < WEEK_MS) {
    memory.set(key, stored);
    return stored;
  }

  const profile = await buildProfile(user.favourites, { city: cityName });
  const rec = { id: key, city: cityName, builtAt: new Date(now).toISOString(), ...profile };
  memory.set(key, rec);
  await put("profiles", rec).catch(() => {}); // a store hiccup shouldn't lose the answer
  return rec;
}

const NO_TASTE = () => ({ match: null, because: { bothLove: [], music: [], places: [], wouldGoTo: [] }, line: "Hasn't added their taste yet" });

/** How alike `viewer` and `other` are in a city: 0–100, the reasons, and one line to read. */
export async function likeness(viewer, other, cityName = cityOf(viewer).name) {
  const [a, b] = await Promise.all([profileFor(viewer, cityName), profileFor(other, cityName)]);
  if (!a || !b) return NO_TASTE();
  const cmp = compareProfiles(a, b, { namesA: viewer.favourites.map((f) => f.name), namesB: other.favourites.map((f) => f.name) });
  return { ...cmp, line: matchLine(cmp) };
}

/** For tests: forget profiles held in memory. */
export const forgetProfiles = () => memory.clear();
