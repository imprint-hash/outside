/**
 * Who's in the room, as counts: how many people are checked in at each venue
 * tonight, and how many of them share your taste. This is the "people like
 * you" glow on the map and the faces on a place card.
 *
 * Privacy rules, kept here so no screen can get around them:
 * - Counts and avatars only. Never a name, a user id or a location; names
 *   and saying hi come only from whoIsHere, once you're checked in there.
 * - Anyone who chose "nobody", and anyone blocked either way, isn't counted.
 * - Faces follow each person's visibility ("strong", "verified"), and a
 *   viewer who is invisible sees counts only.
 */

import { get } from "./store.js";
import { activeCheckins, blocked, allowedToSee, STRONG_MATCH } from "./people.js";
import { likeness } from "./likeness.js";
import { avatarOf } from "./auth.js";
import { cityOf, cityNear } from "./cities.js";

/** A match at or above this counts as "like you". Tune from the demo match matrix. */
export const LIKE_YOU = 40; // tuned on the London demo: same-genre pairs score 55–79, different tastes 10–30
const MAX_FACES = 6;
const AT_ONCE = 4;

/** Run `fn` over `items`, at most `n` at a time, keeping order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const inCity = (c, cityName) => (c.city ? c.city === cityName : c.venueLocation ? cityNear(c.venueLocation)?.name === cityName : false);

/**
 * For each venue with someone checked in (only `venueIds` when given), a Map
 * from venueId to { venueId, venueName, location, here, likeYou, strong,
 * demo, plumbob, faces? }. `demo` counts labelled demo people in `here`, and
 * each face says whether it's a demo person.
 */
export async function crowdAt(viewer, venueIds = null, { now = new Date(), cityName = cityOf(viewer).name, faces = false } = {}) {
  const only = venueIds ? new Set(venueIds) : null;
  const rows = await activeCheckins((c) => c.userId !== viewer.id && inCity(c, cityName) && (!only || only.has(c.venueId)), now);

  // One check-in per person: the latest.
  const latest = new Map();
  for (const c of rows) if (!latest.has(c.userId) || latest.get(c.userId).at < c.at) latest.set(c.userId, c);

  const seen = await pool([...latest.values()], AT_ONCE, async (c) => {
    const u = await get("users", c.userId);
    if (!u || (u.visibility || "everyone") === "nobody") return null;
    if (await blocked(viewer.id, u.id)) return null;
    const like = await likeness(viewer, u, cityName);
    return { c, u, like };
  });

  const out = new Map();
  for (const s of seen.filter(Boolean)) {
    const { c, u, like } = s;
    let v = out.get(c.venueId);
    if (!v) {
      v = { venueId: c.venueId, venueName: c.venueName, location: c.venueLocation || null, here: 0, likeYou: 0, strong: 0, demo: 0, plumbob: null, ...(faces ? { faces: [] } : {}) };
      out.set(c.venueId, v);
    }
    const m = like.match ?? 0;
    v.here++;
    if (u.demo) v.demo++;
    if (m >= LIKE_YOU) v.likeYou++;
    if (m >= STRONG_MATCH) v.strong++;
    if (faces && viewer.visibility !== "nobody" && allowedToSee(viewer, u, m)) {
      v.faces.push({ avatar: avatarOf(u), bubbles: [...like.because.bothLove, ...like.because.music].slice(0, 3), match: like.match, line: like.line, demo: !!u.demo });
    }
  }
  for (const v of out.values()) {
    v.plumbob = v.strong ? "strong" : v.likeYou ? "okay" : null;
    if (faces) v.faces = v.faces.sort((a, b) => (b.match ?? -1) - (a.match ?? -1)).slice(0, MAX_FACES);
  }
  return out;
}
