/**
 * Place card, reviews and venue (organiser) routes. Same [method, path,
 * handler(ctx)] format as the router; `publicPaths` need no signed-in user.
 */

import { HttpError } from "../http.js";
import { eventsInCity } from "../city-events.js";
import { cityDashboard, venueDashboard } from "../organiser.js";
import { placeCard } from "../place-card.js";
import { addReview, pendingReviews } from "../reviews.js";
import { entityById, shortName } from "../places.js";
import { renewDemoCheckins } from "../demo.js";
import { removeOldGuests } from "../guest.js";
import { findEntity } from "../qloo.js";
import { put, list } from "../store.js";
import { cityOf, cityNear } from "../cities.js";

const EVENTS_PER_HOUR = 10;

const bearer = (req, secret) => Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;

const organiserOnly = (user, message = "This view is for event organisers and venues.") => {
  if (user.guest === true) throw new HttpError("Guests can't run a venue. Sign up as a venue to add your own.", 403);
  if (user.role !== "organiser") throw new HttpError(message, 403);
};

/** ?lat&lon if both are numbers, else where the user is staying, else none. */
function originFrom(query, user) {
  const lat = Number(query.get("lat")), lon = Number(query.get("lon"));
  if (query.get("lat") !== null && query.get("lon") !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  return user.stay && Number.isFinite(user.stay.lat) ? { lat: user.stay.lat, lon: user.stay.lon } : null;
}

export const routes = [
  ["GET", "/api/places/:id", async ({ user, params, query }) => {
    const m = query.get("match");
    return placeCard(user, params.id, { origin: originFrom(query, user), match: m === null || m === "" ? null : Number(m) });
  }],

  ["POST", "/api/reviews", async ({ user, body }) => ({ review: await addReview(user, { placeId: body.placeId, stars: body.stars, note: body.note }) })],
  ["GET", "/api/reviews/pending", async ({ user }) => ({ pending: await pendingReviews(user) })],

  ["POST", "/api/organiser/venue", async ({ user, body }) => {
    organiserOnly(user, "Only organisers and venues can pick a venue.");
    if (!body.venueId || typeof body.venueId !== "string") throw new HttpError("Which venue? Send venueId.", 400);
    const e = await entityById(body.venueId);
    if (!e.location) throw new HttpError("That place has no location on record.", 422);
    const venue = { id: e.entity_id, name: shortName(e.name), location: { lat: e.location.lat, lon: e.location.lon } };
    const held = await list("users", (u) => u.id !== user.id && u.role === "organiser" && (u.venueId === venue.id || u.venueId === body.venueId));
    if (held.length) throw new HttpError("Another organiser already manages that venue. Contact us if it's yours.", 409);
    await put("users", { ...user, venueId: venue.id, venueName: venue.name, venueLocation: venue.location, venueCity: cityNear(venue.location)?.name ?? cityOf(user).name });
    return { venue };
  }],

  ["GET", "/api/organiser/dashboard", async ({ user, query }) => {
    organiserOnly(user);
    const cityName = user.venueCity || cityOf(user).name;
    const asked = query.get("days");
    const days = asked === null || asked === "" ? 0 : Math.max(1, Math.round(Number(asked) || 7));
    const want = String(query.get("want") || "").trim().slice(0, 80) || null;
    const mine = (await eventsInCity(cityName)).filter((e) => e.ownerId === user.id || e.status === "announced");
    const [venue, city] = await Promise.all([
      user.venueId ? venueDashboard({ venueId: user.venueId, cityName, days: Math.min(90, days || 28), want }) : null,
      cityDashboard({ days: Math.min(30, days || 7), events: mine, cityName }),
    ]);
    return {
      venue: venue && { id: user.venueId, name: user.venueName || null, ...venue },
      city,
      events: mine.map((e) => ({ id: e.id, title: e.title, starts: e.starts, ends: e.ends, venue: e.venue, lineup: e.lineup, status: e.status, city: e.city })),
    };
  }],

  ["POST", "/api/organiser/events", async ({ user, body }) => {
    organiserOnly(user, "Only organisers can add events.");
    const hourAgo = Date.now() - 3600_000;
    const recent = await list("events", (e) => e.ownerId === user.id && new Date(e.createdAt || 0).getTime() > hourAgo);
    if (recent.length >= EVENTS_PER_HOUR) throw new HttpError(`That's ${EVENTS_PER_HOUR} events in an hour. Try again a bit later.`, 429);
    const title = String(body.title || "").trim().slice(0, 120);
    const lineup = (Array.isArray(body.lineup) ? body.lineup : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    const starts = new Date(body.starts), ends = new Date(body.ends || body.starts);
    const lat = Number(body.venue?.lat), lon = Number(body.venue?.lon);
    if (!title || !lineup.length || isNaN(starts) || isNaN(ends) || ends < starts || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new HttpError("An event needs a title, a lineup, start and end times, and a venue with lat and lon.", 400);
    }
    const artistIds = Object.fromEntries(await Promise.all(lineup.map(async (n) => [n, (await findEntity(n, "urn:entity:artist").catch(() => null))?.entity_id ?? null])));
    const city = cityNear({ lat, lon })?.name ?? user.city ?? cityOf(user).name;
    return { event: await put("events", { title, kind: body.kind || "event", status: "listed", ownerId: user.id, createdAt: new Date().toISOString(), city, starts: starts.toISOString(), ends: ends.toISOString(), venue: { name: String(body.venue.name || "Venue").slice(0, 80), lat, lon }, lineup, artistIds }) };
  }],

  ["GET", "/api/cron/demo", async ({ req }) => {
    if (!bearer(req, process.env.CRON_SECRET)) throw new HttpError("Not allowed.", 403);
    return { renewed: await renewDemoCheckins(), guestsRemoved: await removeOldGuests() };
  }],
];

export const publicPaths = ["/api/cron/demo"];
