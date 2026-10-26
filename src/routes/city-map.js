/**
 * City, events and map routes. Same [method, path, handler(ctx)] format as
 * the router; `publicPaths` need no signed-in user.
 */

import { HttpError } from "../http.js";
import { selfView } from "../auth.js";
import * as people from "../people.js";
import { eventsForYou, afterTheShow } from "../events.js";
import { eventsInCity, allEvents, ensureFresh, searchAndMark, activeCities } from "../city-events.js";
import { CITIES, DEFAULT_CITY, cityOf, cityNamed, publicCity } from "../cities.js";
import { crowdAt } from "../crowd.js";
import { mapFor, timeWindow, eventInWindow } from "../map.js";
import { background } from "../background.js";
import { travel } from "../geo.js";
import { rideLinks } from "../rides.js";

const pointFrom = (query) => {
  const lat = Number(query.get("lat")), lon = Number(query.get("lon"));
  if (query.get("lat") == null || query.get("lon") == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError("That location doesn't look right.", 400);
  return { lat, lon, label: "Your location" };
};

const bearer = (req, secret) => Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;

/** Every city's search, side by side; one failing doesn't stop the others. */
async function refreshAll(cities) {
  const settled = await Promise.allSettled(cities.map((c) => searchAndMark(c)));
  return settled.map((s, i) => (s.status === "fulfilled" ? s.value : { city: cities[i], error: String(s.reason?.message || s.reason) }));
}

async function findEvent(user, id) {
  return (await eventsInCity(cityOf(user).name)).find((e) => e.id === id) || (await allEvents()).find((e) => e.id === id) || null;
}

export const routes = [
  ["GET", "/api/cities", async () => ({ cities: CITIES.map(publicCity), default: DEFAULT_CITY })],

  ["POST", "/api/me/city", async ({ user, body }) => {
    const saved = await people.setCity(user, { city: body.city, lat: Number(body.lat), lon: Number(body.lon) });
    const city = cityOf(saved);
    background(ensureFresh(city.name)); // warm this city's events while they look around
    return { user: selfView(saved), city: publicCity(city) };
  }],
  ["POST", "/api/me/stay", async ({ user, body }) => {
    const saved = await people.setStay(user, body.stay);
    return { user: selfView(saved), stay: saved.stay };
  }],

  ["GET", "/api/events", async ({ user, query }) => {
    const city = cityOf(user);
    const now = new Date();
    const status = await ensureFresh(city.name, { now });
    let pool = await eventsInCity(city.name, { now });
    if (query.get("when")) {
      const w = timeWindow(query.get("when"), now, city.tz);
      pool = pool.filter((e) => eventInWindow(e, w));
    }
    const [scored, crowd] = await Promise.all([
      eventsForYou({ favourites: user.favourites, events: pool, from: query.get("from"), to: query.get("to") }),
      crowdAt(user, null, { now, cityName: city.name }),
    ]);
    const events = scored.map((e) => ({ ...e, city: e.city || city.name, likeYou: e.venue?.qlooId ? crowd.get(e.venue.qlooId)?.likeYou ?? 0 : null }));
    return { city: publicCity(city), events, status };
  }],
  ["GET", "/api/events/:id", async ({ user, params, query }) => {
    const ev = await findEvent(user, params.id);
    if (!ev) throw new HttpError("No such event.", 404);
    const city = cityOf(user);
    const now = new Date();
    const origin = pointFrom(query) || user.stay || null;
    const [[event], crowd] = await Promise.all([
      eventsForYou({ favourites: user.favourites, events: [ev] }),
      ev.venue?.qlooId ? crowdAt(user, [ev.venue.qlooId], { now, cityName: ev.city || city.name, faces: true }) : new Map(),
    ]);
    const to = Number.isFinite(ev.venue?.lat) ? { lat: ev.venue.lat, lon: ev.venue.lon } : null;
    return {
      event,
      crowd: (ev.venue?.qlooId && crowd.get(ev.venue.qlooId)) || null,
      ride: to ? rideLinks({ from: origin, to, toName: ev.venue.name, cc: city.cc }) : null,
      trip: origin && to ? travel(origin, to, now, city.tz) : null,
    };
  }],
  ["GET", "/api/events/:id/after", async ({ user, params }) => {
    const ev = await findEvent(user, params.id);
    if (!ev) throw new HttpError("No such event.", 404);
    return { event: ev.title, places: await afterTheShow({ event: ev, favourites: user.favourites, timeZone: cityOf(user).tz }) };
  }],

  ["GET", "/api/map", async ({ user, query }) =>
    mapFor(user, { when: query.get("when") || "tonight", kinds: query.get("kinds") || undefined, origin: pointFrom(query) })],

  // The events search by hand, for one city or every active one.
  ["POST", "/api/admin/refresh-events", async ({ req, body }) => {
    if (!bearer(req, process.env.ADMIN_TOKEN)) throw new HttpError("Not allowed.", 403);
    if (body.city && !cityNamed(body.city)) throw new HttpError(`Outside doesn't cover ${String(body.city).slice(0, 40)} yet.`, 400);
    return { results: await refreshAll(body.city ? [body.city] : await activeCities()) };
  }],
  // The daily events search, called by the host's scheduler.
  ["GET", "/api/cron/events", async ({ req }) => {
    if (!bearer(req, process.env.CRON_SECRET)) throw new HttpError("Not allowed.", 403);
    return { results: await refreshAll(await activeCities()) };
  }],
];

export const publicPaths = ["/api/cities", "/api/admin/refresh-events", "/api/cron/events"];
