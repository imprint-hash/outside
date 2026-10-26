/**
 * Places: near where you're staying, your home favourites translated into a
 * new city, and "tonight" (where to go next from the venue you're at).
 *
 * Qloo does the taste part: given the things you love (or the venue you're
 * standing in), it ranks real places by how strongly the same people like
 * them. This module adds what a visitor needs on top: distance and travel
 * time at this hour, open now or not, price level, what reviewers keep
 * mentioning, and why each pick fits. Places that are not nights out
 * (churches, schools, clinics) are dropped.
 */

import { insights, findEntity, qloo, QlooError } from "./qloo.js";
import { distanceM, travel, LAGOS_AREAS } from "./geo.js";
import { openStatus, zoneFor } from "./hours.js";

export const CATEGORIES = {
  restaurant: "urn:tag:category:place:restaurant",
  lounge: "urn:tag:category:place:lounge",
  club: "urn:tag:category:place:night_club",
  bar: "urn:tag:category:place:bar",
};

// Not a night out, whatever the taste graph says.
const NOT_A_NIGHT_OUT = /worship|church|mosque|cathedral|school|universit|college|hospital|clinic|pharmac|bank|government|embassy|airport|car rental|gas station|real estate/i;
// Words reviewers use that say nothing about the place.
const EMPTY_WORDS = /^(food|service|staff|place|price|prices|ambience|atmosphere|vibe|vibes|experience|time|people|money|value|quality|menu|order|wait|waiter|waitress|courteous staff|food portions)$/i;

const PRICE = { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };

/** What reviewers keep mentioning, most-mentioned first. */
export function saying(keywords, limit = 4) {
  return (Array.isArray(keywords) ? keywords : [])
    .filter((k) => k?.name && !EMPTY_WORDS.test(k.name.trim()) && (k.count ?? 0) >= 3)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, limit)
    .map((k) => ({ text: k.name.trim(), mentions: k.count }));
}

function vibe(tags) {
  return (Array.isArray(tags) ? tags : [])
    .filter((t) => /ambience|decor|offerings:place:dancing|offerings:place:live_music|interests:qloo|crowd/.test(t.id || ""))
    .map((t) => t.name)
    .slice(0, 4);
}

function isNightOut(e) {
  const list = (x) => (Array.isArray(x) ? x : []);
  const words = [e.name, ...list(e.tags).map((t) => `${t.id} ${t.name}`), ...list(e.properties?.good_for).map((t) => t.id)].join(" ");
  return !NOT_A_NIGHT_OUT.test(words);
}

/** "Yakoyo Abula Joint (VI Branch) - Amala | Rice | Igbo Soups" -> "Yakoyo Abula Joint (VI Branch)". */
export function shortName(name) {
  const cut = String(name || "").split(/\s+[|\-–—]\s+|\s*\|\s*/)[0].trim();
  return cut.length >= 3 ? cut : String(name || "").trim();
}

/** A place as the app shows it. `because` names the things the match was built from. */
export function shapePlace(e, { origin, now = new Date(), timeZone, because = [] } = {}) {
  const p = e.properties || {};
  const where = e.location ? { lat: e.location.lat, lon: e.location.lon } : null;
  const affinity = e.query?.affinity ?? null;
  return {
    id: e.entity_id,
    name: shortName(e.name),
    fullName: e.name,
    area: p.geocode?.name || p.neighborhood || null,
    address: p.address || null,
    location: where,
    price: PRICE[p.price_level] || null,
    rating: p.business_rating ? Math.round(p.business_rating * 10) / 10 : null,
    hours: openStatus(p.hours, now, timeZone || zoneFor(e)),
    trip: origin && where ? travel(origin, where, now, timeZone || zoneFor(e)) : null,
    image: (Array.isArray(p.images) && p.images[0]?.url) || p.image?.url || null,
    website: p.website || null,
    phone: p.phone || null,
    saying: saying(p.keywords),
    vibe: vibe(e.tags),
    match: affinity === null ? null : Math.round(affinity * 100),
    why: because.length ? `People who love ${listOf(because)} also go here.` : null,
  };
}

function listOf(names) {
  const n = names.slice(0, 3);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

/**
 * Where you're staying, as a point. Accepts { lat, lon }, a place name Qloo
 * knows in your city ("The Hoxton, Shoreditch"), or in Lagos one of the areas
 * people give instead of an address ("Lekki Phase 1").
 */
export async function resolveOrigin(input, city = "Lagos") {
  if (input && typeof input === "object" && Number.isFinite(input.lat) && Number.isFinite(input.lon)) {
    if (Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180) throw new QlooError("That location doesn't look right.", 400);
    return { lat: input.lat, lon: input.lon, label: input.label || "Your location" };
  }
  const text = String(input || "").trim();
  if (!text) throw new QlooError("Tell Outside where you're staying: a hotel, an area, or your location.", 400);
  const area = city === "Lagos" ? LAGOS_AREAS[text.toLowerCase()] : null;
  if (area) return { lat: area.lat, lon: area.lon, label: titleCase(text) };
  const e = await findEntity(text, "urn:entity:place", { city });
  if (!e?.location) throw new QlooError(`Could not find "${text}". Try the hotel's full name, or use your location.`, 404);
  return { lat: e.location.lat, lon: e.location.lon, label: e.name, id: e.entity_id };
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Ask Qloo for places of the given kinds around a point, ranked by taste when
 * `signals` (entity ids) are given. One call per kind, merged and de-duplicated.
 */
async function placesAround({ origin, kinds, signals = [], radius = 5000, take = 20, extra = {} }) {
  const lists = await Promise.all(
    kinds.map((k) =>
      insights({
        "filter.type": "urn:entity:place",
        "filter.location": `POINT(${origin.lon} ${origin.lat})`,
        "filter.location.radius": radius,
        "filter.tags": CATEGORIES[k],
        "signal.interests.entities": signals.length ? signals : undefined,
        take,
        ...extra,
      }).then((r) => (r.entities || []).map((e) => ({ ...e, kind: k }))),
    ),
  );
  const seen = new Map();
  for (const e of lists.flat()) {
    const prev = seen.get(e.entity_id);
    if (!prev || (e.query?.affinity ?? 0) > (prev.query?.affinity ?? 0)) seen.set(e.entity_id, e);
  }
  return [...seen.values()].filter(isNightOut);
}

/**
 * Rank by taste, but don't let a long trip win. Qloo's scores for places that
 * suit the same crowd sit close together (90, 91, 92), so a few points of
 * match are worth less than half an hour in traffic.
 */
function rankScore(p) {
  const taste = p.match ?? 0;
  const minutes = p.trip?.minutes ?? 15;
  const rating = p.rating ?? 4;
  return taste - Math.max(0, minutes - 20) * 0.15 + (rating - 4) * 4;
}
const byTaste = (a, b) => rankScore(b) - rankScore(a);

/**
 * A label for each pick that means something within this list. When every
 * score is within a few points, the list says "fits" rather than pretending
 * 99% and 98% are different.
 */
function labelFits(places) {
  const scores = places.map((p) => p.match).filter((m) => m != null);
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  return places.map((p, i) => ({
    ...p,
    fit: p.match == null ? null : spread < 4 ? (i < 2 ? "Top pick" : "Fits this crowd") : p.match >= Math.max(...scores) - spread / 3 ? "Top match" : p.match >= Math.max(...scores) - (2 * spread) / 3 ? "Strong match" : "Good match",
  }));
}

/** Places near where you're staying that fit what you love. */
export async function nearYou({ origin, favourites = [], kinds = ["restaurant", "lounge", "club", "bar"], radius = 5000, limit = 12, now = new Date(), openNow = false, timeZone }) {
  const ids = favourites.map((f) => f.id);
  const found = await placesAround({ origin, kinds, signals: ids, radius });
  let places = found.map((e) => ({ ...shapePlace(e, { origin, now, timeZone, because: favourites.map((f) => f.name) }), kind: e.kind }));
  if (openNow) places = places.filter((p) => !p.hours.known || p.hours.open);
  return labelFits(places.sort(byTaste).slice(0, limit));
}

/**
 * Your home favourites, translated into another city: the places there that
 * people who love your places back home also love.
 */
export async function translateCity({ favourites, city = "Lagos", origin = null, kinds = ["restaurant", "lounge", "bar", "club"], limit = 10, now = new Date(), timeZone }) {
  if (!favourites?.length) throw new QlooError("Add at least one place or artist you love back home.", 400);
  const ids = favourites.map((f) => f.id);
  const lists = await Promise.all(
    kinds.map((k) =>
      insights({ "filter.type": "urn:entity:place", "filter.location.query": city, "filter.tags": CATEGORIES[k], "signal.interests.entities": ids, take: 15 }).then((r) =>
        (r.entities || []).map((e) => ({ ...e, kind: k })),
      ),
    ),
  );
  const seen = new Map();
  for (const e of lists.flat()) if (!seen.has(e.entity_id)) seen.set(e.entity_id, e);
  const out = [...seen.values()]
    .filter(isNightOut)
    .map((e) => ({ ...shapePlace(e, { origin, now, timeZone, because: favourites.map((f) => f.name) }), kind: e.kind }))
    .sort(byTaste)
    .slice(0, limit);
  return labelFits(out);
}

/** A Qloo entity by id (for the venue you're checked in at). */
export async function entityById(id) {
  const r = await qloo("/entities", { entity_ids: id });
  const e = r.results?.[0];
  if (!e) throw new QlooError("That place could not be found.", 404);
  return e;
}

/**
 * One place with everything Qloo knows about it. Only /v2/insights carries the
 * review data (keywords, service/ambience/crowd summaries); /search and
 * /entities are slim. Asked with no signal, since a signal makes this call
 * come back empty. Falls back to /entities if insights has nothing.
 */
export async function placeFull(id) {
  if (!id) throw new QlooError("Which place? Send its id.", 400);
  const r = await insights({ "filter.type": "urn:entity:place", "filter.results.entities": id, take: 1 });
  const e = (r.entities || []).find((x) => x.entity_id === id) || r.entities?.[0];
  if (e) return e;
  return entityById(id);
}

/**
 * Tonight: you're at a venue and want what's next. Places close by, open now,
 * that people who go to this venue also like.
 */
export async function tonight({ venueId, kinds = ["restaurant"], radius = 2500, limit = 5, now = new Date(), timeZone }) {
  const venue = await entityById(venueId);
  if (!venue.location) throw new QlooError("That venue has no location on record.", 422);
  const origin = { lat: venue.location.lat, lon: venue.location.lon };
  const found = await placesAround({ origin, kinds, signals: [venueId], radius, take: 25 });
  const places = found
    .filter((e) => e.entity_id !== venueId)
    .map((e) => ({ ...shapePlace(e, { origin, now, timeZone, because: [venue.name] }), kind: e.kind }))
    .filter((p) => p.hours.open || (p.hours.known && p.hours.opensIn != null && p.hours.opensIn <= 30))
    .sort(byTaste)
    .slice(0, limit);
  return { venue: { id: venue.entity_id, name: venue.name, location: origin }, places: labelFits(places), closedOrUnknown: found.length - places.length };
}

export { distanceM };
