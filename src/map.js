/**
 * The Tonight map: venues near you that fit your taste, events whose lineup
 * fits you, and on each a "people like you" count. Qloo ranks the venues and
 * scores the lineups; check-ins add who's actually there. Counts only, never
 * anyone's location.
 */

import { nearYou } from "./places.js";
import { eventsForYou } from "./events.js";
import { eventsInCity, ensureFresh } from "./city-events.js";
import { crowdAt } from "./crowd.js";
import { cityOf } from "./cities.js";
import { nextLocalHour, travel } from "./geo.js";
import { HttpError } from "./http.js";

export const MAP_KINDS = {
  food: { places: ["restaurant"], events: [] },
  drinks: { places: ["bar", "lounge"], events: [] },
  music: { places: ["club"], events: ["concert", "festival", "party", "other"] },
  comedy: { places: [], events: ["comedy"] },
};
export const WHEN = ["now", "tonight", "week"];
const EVENT_KINDS = new Set(["concert", "festival", "party", "comedy", "other"]);

/**
 * The time a filter covers. Events show when they overlap [from, to]; places
 * follow `placeRule`: open now, open now or within 3 hours, or any.
 */
export function timeWindow(when, now = new Date(), tz = "UTC") {
  if (when === "now") return { from: now, to: now, placeRule: "openNow" };
  if (when === "tonight") return { from: now, to: nextLocalHour(now, tz, 6), placeRule: "openSoon" };
  if (when === "week") return { from: now, to: new Date(now.getTime() + 7 * 86400_000), placeRule: "any" };
  throw new HttpError(`Unknown time: ${String(when).slice(0, 20)}. Use ${WHEN.join(", ")}.`, 400);
}

/** Does an event overlap the window? Running now counts; ended doesn't. */
export const eventInWindow = (ev, w) => new Date(ev.ends || ev.starts) > w.from && new Date(ev.starts) <= w.to;

const placeFits = (p, rule) => {
  if (rule === "any" || !p.hours?.known) return true;
  if (p.hours.open) return true;
  return rule === "openSoon" && p.hours.opensIn != null && p.hours.opensIn <= 180;
};

/** Filter names ("food,drinks") → the Qloo place kinds and event kinds they cover. */
export function kindsFor(kinds = Object.keys(MAP_KINDS)) {
  const list = (Array.isArray(kinds) ? kinds : String(kinds || "").split(",")).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((k) => !MAP_KINDS[k]);
  if (bad.length) throw new HttpError(`Unknown kind: ${bad.join(", ").slice(0, 40)}. Use ${Object.keys(MAP_KINDS).join(", ")}.`, 400);
  const use = list.length ? [...new Set(list)] : Object.keys(MAP_KINDS);
  return {
    kinds: use,
    places: [...new Set(use.flatMap((k) => MAP_KINDS[k].places))],
    events: new Set(use.flatMap((k) => MAP_KINDS[k].events)),
  };
}

export const eventKindOf = (ev) => (EVENT_KINDS.has(ev.kind) ? ev.kind : "other");
const countsOf = (c) => (c ? { here: c.here, likeYou: c.likeYou, strong: c.strong, plumbob: c.plumbob } : { here: 0, likeYou: 0, strong: 0, plumbob: null });

/** The whole map for one viewer. */
export async function mapFor(viewer, { when = "tonight", kinds, origin = null, now = new Date(), waitMs } = {}) {
  const city = cityOf(viewer);
  const win = timeWindow(when, now, city.tz);
  const want = kindsFor(kinds);
  const from = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon)
    ? { lat: origin.lat, lon: origin.lon, label: origin.label || "Your location" }
    : viewer.stay || { lat: city.lat, lon: city.lon, label: `Central ${city.name}` };

  const [places, eventsStatus, crowd] = await Promise.all([
    want.places.length
      ? nearYou({ origin: from, favourites: viewer.favourites, kinds: want.places, radius: when === "week" ? 8000 : 4000, limit: 40, now, timeZone: city.tz })
      : [],
    ensureFresh(city.name, { now, ...(waitMs != null ? { waitMs } : {}) }),
    crowdAt(viewer, null, { now, cityName: city.name }),
  ]);

  let venues = places.filter((p) => placeFits(p, win.placeRule)).map((p) => ({
    id: p.id, name: p.name, category: p.kind ?? null, location: p.location, area: p.area, match: p.match, fit: p.fit, why: p.why,
    rating: p.rating, price: p.price, hours: p.hours, trip: p.trip, image: p.image, crowd: countsOf(crowd.get(p.id)),
  }));
  // Venues people are checked in at always show, even when Qloo's list missed them.
  const shown = new Set(venues.map((v) => v.id));
  for (const c of crowd.values()) {
    if (shown.has(c.venueId) || !c.location) continue;
    venues.push({
      id: c.venueId, name: c.venueName, category: null, location: c.location, area: null, match: null, fit: null, why: null,
      rating: null, price: null, hours: { known: false }, trip: travel(from, c.location, now, city.tz), image: null, crowd: countsOf(c),
    });
  }
  // Most people like you first; ties keep Qloo's taste-and-distance order.
  venues = venues.map((v, i) => [v, i]).sort((a, b) => b[0].crowd.likeYou - a[0].crowd.likeYou || a[1] - b[1]).map(([v]) => v);

  const pool = (await eventsInCity(city.name, { now })).filter((ev) => eventInWindow(ev, win) && want.events.has(eventKindOf(ev)));
  const scored = (await eventsForYou({ favourites: viewer.favourites, events: pool })).slice(0, 20);
  const events = scored.map((ev) => ({
    id: ev.id, title: ev.title, eventKind: eventKindOf(ev), starts: ev.starts, ends: ev.ends,
    venue: { name: ev.venue?.name, lat: ev.venue?.lat, lon: ev.venue?.lon, approximate: Boolean(ev.venue?.approximate), qlooId: ev.venue?.qlooId ?? null },
    fit: ev.fit, label: ev.label, why: ev.why, artists: ev.artists, source: ev.source ?? null,
    crowd: ev.venue?.qlooId && crowd.has(ev.venue.qlooId) ? countsOf(crowd.get(ev.venue.qlooId)) : null,
  }));

  return {
    city: { name: city.name, tz: city.tz, lat: city.lat, lon: city.lon, cc: city.cc },
    origin: from,
    when,
    kinds: want.kinds,
    venues,
    events,
    eventsStatus,
    generatedAt: now.toISOString(),
  };
}
