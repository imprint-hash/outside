/**
 * Events ranked by how well the lineup fits you.
 *
 * Qloo has no event listings, so events come from two places: a short file of
 * announced December events (data/events.json) and events organisers add
 * themselves. Every event names its artists: a real lineup when announced, or
 * for an example event, artists that describe its sound, labelled as such so
 * nobody thinks they are booked. Qloo scores each artist against the things
 * you love, and an event's fit is the average of its best two scores.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findEntity } from "./qloo.js";
import { scoreArtists } from "./taste.js";
import { nearYou } from "./places.js";

const FILE = fileURLToPath(new URL("../data/events.json", import.meta.url));
let seeded = null;
export function seededEvents() {
  if (!seeded) seeded = JSON.parse(readFileSync(FILE, "utf8"));
  return seeded;
}

const artistIds = new Map();
async function artistId(name) {
  if (artistIds.has(name)) return artistIds.get(name);
  const e = await findEntity(name, "urn:entity:artist");
  const id = e?.entity_id ?? null;
  artistIds.set(name, id);
  return id;
}

const artistsOf = (ev) => ev.lineup?.length ? ev.lineup : ev.sound || [];

/**
 * Events between `from` and `to`, best fit first. Events with no artist Qloo
 * knows still appear, unscored, after the scored ones.
 */
export async function eventsForYou({ favourites, events, from = null, to = null }) {
  const pool = events.filter((ev) => (!from || new Date(ev.ends || ev.starts) >= new Date(from)) && (!to || new Date(ev.starts) <= new Date(to)));
  // Found events carry their artists' Qloo ids, resolved once when found,
  // so a page load doesn't search for every name again.
  const resolved = Object.assign({}, ...pool.map((ev) => ev.artistIds || {}));
  const names = [...new Set(pool.flatMap(artistsOf))];
  const ids = Object.fromEntries(await Promise.all(names.map(async (n) => [n, Object.hasOwn(resolved, n) ? resolved[n] : await artistId(n)])));
  const scores = favourites?.length ? await scoreArtists(favourites, Object.values(ids).filter(Boolean)) : {};

  return pool
    .map((ev) => {
      // Qloo leaves the things you gave it out of its answer, so an artist you
      // already love has no score: that is the best possible fit, not unknown.
      const loved = new Set((favourites || []).map((f) => f.id));
      const per = artistsOf(ev).map((n) => ({
        name: n,
        youLove: Boolean(ids[n] && loved.has(ids[n])),
        fit: ids[n] && loved.has(ids[n]) ? 100 : ids[n] && scores[ids[n]] != null ? Math.round(scores[ids[n]] * 100) : null,
      }));
      const known = per.map((p) => p.fit).filter((f) => f != null).sort((a, b) => b - a);
      const fit = known.length ? Math.round(known.slice(0, 2).reduce((x, y) => x + y, 0) / Math.min(2, known.length)) : null;
      const best = per.filter((p) => p.fit != null).sort((a, b) => b.fit - a.fit)[0];
      return {
        ...ev,
        artists: per,
        fit,
        label: fit == null ? null : fit >= 90 ? "Strong match for you" : fit >= 80 ? "Good match" : fit >= 70 ? "Could be fun" : "Probably not your sound",
        why: !best ? null
          : best.youLove ? `${ev.lineup?.length ? "On the lineup" : "Sounds like"}: ${best.name}, who you love.`
          : `${ev.lineup?.length ? "On the lineup" : "Sounds like"}: ${best.name}, a ${best.fit}% fit with what you love.`,
      };
    })
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || new Date(a.starts) - new Date(b.starts));
}

/** After the show: places near the venue, open when it ends, that fit you. */
export async function afterTheShow({ event, favourites, kinds = ["restaurant", "lounge", "bar"], limit = 4, timeZone }) {
  const end = new Date(event.ends || event.starts);
  const places = await nearYou({ origin: { lat: event.venue.lat, lon: event.venue.lon }, favourites, kinds, radius: 3000, limit: 12, now: end, openNow: true, timeZone });
  return places.filter((p) => p.hours.known).slice(0, limit);
}

/** Before the show: somewhere to eat near the venue, open two hours before it starts. */
export async function beforeTheShow({ event, favourites, kinds = ["restaurant"], limit = 4, timeZone }) {
  const at = new Date(new Date(event.starts).getTime() - 2 * 3600_000);
  const places = await nearYou({ origin: { lat: event.venue.lat, lon: event.venue.lon }, favourites, kinds, radius: 3000, limit: 12, now: at, openNow: true, timeZone });
  return places.filter((p) => p.hours.known).slice(0, limit);
}
