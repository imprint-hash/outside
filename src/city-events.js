/**
 * Finds real upcoming events in any city we cover, once a day per city.
 *
 * Qloo has no event listings, so Claude searches the web for them: concerts,
 * club nights, festivals and comedy, each with a date, a venue and the names
 * on the bill. Qloo then does the part that matters, scoring each lineup
 * against each visitor's taste (see events.js). Claude only finds; Qloo
 * decides what fits.
 *
 * Nothing is taken on trust. An event is kept only if it has a title, a start
 * time in the next 120 days, at least one performer, and a source link that
 * was really among the pages the search returned. Venues are placed on the
 * map through Qloo when Qloo knows them, otherwise roughly (by area in Lagos,
 * the city centre elsewhere), and say so.
 */

import "./env.js";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { findEntity } from "./qloo.js";
import { LAGOS_AREAS, distanceM } from "./geo.js";
import { get, list, put, remove } from "./store.js";
import { seededEvents } from "./events.js";
import { cityNamed, cityNear } from "./cities.js";
import { background } from "./background.js";
import { HttpError } from "./http.js";

const MODEL = "claude-opus-5-5";
const HORIZON_DAYS = 120;
const VENUE_MAX_M = 50_000;
// A big city has hundreds of listings; a longer answer gets cut off mid-list.
const MAX_EVENTS = 60;

/** "UTC+01:00" for a time zone on a given day ("UTC+00:00" for London in winter). */
export function utcOffset(timeZone, now = new Date()) {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-]\d{2}:\d{2})?/);
  return `UTC${m?.[1] || "+00:00"}`;
}

const schemaFor = (city, offset) => ({
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "starts", "venue_name", "area", "lineup", "source_url"],
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["concert", "festival", "party", "comedy", "other"] },
          starts: { type: "string", description: `ISO 8601 with offset, e.g. 2026-12-18T20:00:00${offset.slice(3)}. If only the date is known, use 20:00 ${city.name} time.` },
          ends: { type: ["string", "null"] },
          venue_name: { type: "string" },
          area: { type: "string", description: `Neighbourhood or district of ${city.name}` },
          lineup: { type: "array", items: { type: "string" }, description: "Performing artists, DJs or comedians named by the source. Empty if none are named." },
          source_url: { type: "string", description: "The page the details came from." },
        },
      },
    },
  },
});

/** What Claude is asked to find in one city. */
export function eventPrompt(city, today, now = new Date()) {
  const offset = utcOffset(city.tz, now);
  const lagos = city.name === "Lagos" ? " Detty December events matter most." : "";
  return `Today is ${today}. Find real, upcoming events in ${city.name}, ${city.country} (local time is ${offset}): concerts, club nights with named DJs, festivals, and comedy shows. Most of all the next 14 days; up to ${HORIZON_DAYS}.${lagos} List at most ${MAX_EVENTS} events, soonest first.

Search the web, then list each event once with its title, start date and time, venue, the neighbourhood or district of ${city.name}, the artists, DJs or comedians named on the bill, and the link of the page you took the details from. If only the date is known, use 20:00 local time.

Rules:
- Only events whose date you found on a page. Never guess a date.
- Only names a source lists as performing. Never add artists who are merely rumoured.
- If a source names no performers, give an empty lineup.
- Use the event's own page or a news report as the source link.
- Skip past events, and anything outside ${city.name}.`;
}

const urlsSeen = (content) =>
  new Set(
    content
      .filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content))
      .flatMap((b) => b.content.map((r) => r.url))
      .filter(Boolean),
  );

/** Ask Claude to search one city and return events. Resumes long searches that pause. */
export async function searchCityEvents(city, { now = new Date(), client = new Anthropic() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const messages = [{ role: "user", content: eventPrompt(city, today, now) }];
  const schema = schemaFor(city, utcOffset(city.tz, now));
  const seen = new Set();
  let response;

  for (let turn = 0; turn < 4; turn++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 20000, // the SDK refuses non-streamed requests much above 21k
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", city: city.name, country: city.cc, timezone: city.tz } }],
      messages,
    });
    for (const u of urlsSeen(response.content)) seen.add(u);
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") throw new Error(`The search was declined (${response.stop_details?.category || "no reason given"}).`);
  if (response.stop_reason === "max_tokens") throw new Error("The search answer was cut off before it finished.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The search didn't come back as the expected list.");
  }
  return { events: parsed.events || [], sourcesSeen: seen, usage: response.usage };
}

const AREA_ALIASES = { vi: "victoria island", "v.i": "victoria island", "v.i.": "victoria island", lekki: "lekki phase 1" };

/** Put a venue on the map: Qloo first, then (Lagos only) the named area, then the city centre. */
export async function placeVenue(name, area, city = cityNamed("Lagos")) {
  const e = await findEntity(name, "urn:entity:place", { city: city.name }).catch(() => null);
  if (e?.location && distanceM(e.location, city) <= VENUE_MAX_M) return { lat: e.location.lat, lon: e.location.lon, approximate: false, qlooId: e.entity_id };
  if (city.name === "Lagos") {
    const k = String(area || "").toLowerCase().trim();
    const a = LAGOS_AREAS[AREA_ALIASES[k] || k];
    if (a) return { lat: a.lat, lon: a.lon, approximate: true };
  }
  return { lat: city.lat, lon: city.lon, approximate: true };
}

/** The id an event keeps across daily searches. Lagos keeps its older ids. */
const eventId = (city, title, starts) => {
  const base = `${title.toLowerCase().trim()}|${starts.toISOString().slice(0, 10)}`;
  return "found-" + createHash("sha1").update(city.name === "Lagos" ? base : `${city.slug}|${base}`).digest("hex").slice(0, 12);
};

/** Keep only events that pass every check. Returns kept events and why others were dropped. */
export async function vetEvents(raw, sourcesSeen, now = new Date(), city = cityNamed("Lagos")) {
  const kept = [], dropped = [];
  const ids = new Set();
  const artists = new Map();
  const artistId = (n) => {
    if (!artists.has(n)) artists.set(n, findEntity(n, "urn:entity:artist").then((e) => e?.entity_id ?? null, () => null));
    return artists.get(n);
  };
  const horizon = now.getTime() + HORIZON_DAYS * 86400_000;
  for (const ev of raw) {
    const starts = new Date(ev.starts);
    const lineup = (ev.lineup || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    const why =
      !ev.title?.trim() ? "no title"
      : isNaN(starts) ? "no readable date"
      : starts.getTime() < now.getTime() - 6 * 3600_000 ? "already happened"
      : starts.getTime() > horizon ? `more than ${HORIZON_DAYS} days away`
      : !lineup.length ? "no performers named"
      : !/^https?:\/\//.test(ev.source_url || "") ? "no source link"
      : sourcesSeen.size && !sourcesSeen.has(ev.source_url) ? "source link not among the pages searched"
      : null;
    if (why) { dropped.push({ title: ev.title, why }); continue; }
    // The same event reported twice keeps its first sighting.
    const id = eventId(city, ev.title, starts);
    if (ids.has(id)) continue;
    ids.add(id);
    const ends = ev.ends && !isNaN(new Date(ev.ends)) ? new Date(ev.ends) : new Date(starts.getTime() + 5 * 3600_000);
    const [venue, artistIds] = await Promise.all([
      placeVenue(ev.venue_name, ev.area, city),
      Promise.all(lineup.map(async (n) => [n, await artistId(n)])).then(Object.fromEntries),
    ]);
    kept.push({
      id,
      city: city.name,
      title: ev.title.trim().slice(0, 120),
      kind: ev.kind || "event",
      status: "found",
      starts: starts.toISOString(),
      ends: ends.toISOString(),
      venue: { name: String(ev.venue_name || "Venue").slice(0, 80), area: ev.area || null, ...venue },
      lineup,
      artistIds,
      source: ev.source_url,
      foundAt: now.toISOString(),
    });
  }
  return { kept, dropped };
}

const cityOrThrow = (name) => {
  const c = cityNamed(name);
  if (!c) throw new HttpError(`Outside doesn't cover ${String(name).slice(0, 40)} yet.`, 400);
  return c;
};
const cityOfEvent = (e) => e.city || (e.venue && Number.isFinite(e.venue.lat) ? cityNear(e.venue)?.name : null) || "Lagos";

/**
 * The daily job for one city: search, vet, and add today's finds. The web
 * search finds a slightly different set each day, so an event found once
 * stays until it has happened rather than vanishing overnight; a newer
 * sighting of the same event replaces the older one. Organiser-added events
 * and other cities' events are never touched.
 */
export async function refreshCityEvents(cityName, { now = new Date(), client } = {}) {
  const city = cityOrThrow(cityName);
  const { events, sourcesSeen, usage } = await searchCityEvents(city, { now, client });
  const { kept, dropped } = await vetEvents(events, sourcesSeen, now, city);
  const mine = (e) => e.status === "found" && (e.city || "Lagos") === city.name;
  let expired = 0;
  for (const e of await list("events", mine)) {
    if (new Date(e.ends || e.starts) < now) { await remove("events", e.id); expired++; }
  }
  for (const e of kept) await put("events", e);
  const total = (await list("events", mine)).length;
  return { city: city.name, kept: kept.length, expired, total, dropped, usage };
}

export const refreshLagosEvents = (o) => refreshCityEvents("Lagos", o);

/**
 * Every event we know in one city. Real events first: ones found by the
 * daily search and ones organisers add. In Lagos the hand-written examples
 * fill in while fewer than three real events are known, and the announced
 * Detty December opening night always stays; other cities get no examples.
 */
export async function eventsInCity(cityName, { now = new Date() } = {}) {
  const city = cityOrThrow(cityName);
  const stored = (await list("events")).filter((e) => cityOfEvent(e) === city.name);
  const real = stored.filter((e) => new Date(e.ends || e.starts) > now.getTime() - 6 * 3600_000);
  if (city.name !== "Lagos") return real;
  const realIds = new Set(stored.map((e) => e.title.toLowerCase()));
  const seeded = seededEvents().filter((e) => (e.status === "announced" || real.length < 3) && !realIds.has(e.title.toLowerCase())).map((e) => ({ city: "Lagos", ...e }));
  // The found Detty December opening replaces our hand-entered copy of it.
  const foundOpening = real.some((e) => /detty december fest/i.test(e.title) && e.starts.slice(0, 10) === "2026-12-18");
  return [...seeded.filter((e) => !(foundOpening && e.id === "ddf-2026-opening")), ...real];
}

/** Every event in every city (organiser views that predate cities). */
export async function allEvents({ now = new Date() } = {}) {
  const names = new Set((await list("events")).map(cityOfEvent));
  names.add("Lagos");
  return (await Promise.all([...names].filter(cityNamed).map((n) => eventsInCity(n, { now })))).flat();
}

const HOUR = 3600_000;

/**
 * Run one city's search and keep its marker (searches/<slug>) up to date:
 * "running" while it goes, then "done" or "failed". The cron, the admin call
 * and ensureFresh all go through here, so they never double up.
 */
export async function searchAndMark(cityName, { now = new Date(), refresh = refreshCityEvents, client, marker } = {}) {
  const city = cityOrThrow(cityName);
  const prev = marker === undefined ? await get("searches", city.slug) : marker;
  const base = { id: city.slug, city: city.name, startedAt: now.toISOString(), lastSearchAt: prev?.lastSearchAt ?? null, kept: prev?.kept ?? null };
  await put("searches", { ...base, status: "running", lastError: null });
  try {
    const r = await refresh(city.name, { now, ...(client ? { client } : {}) });
    await put("searches", { ...base, status: "done", lastSearchAt: now.toISOString(), lastError: null, kept: r?.kept ?? null });
    return r;
  } catch (err) {
    await put("searches", { ...base, status: "failed", lastError: String(err?.message || err).slice(0, 300) });
    throw err;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

/**
 * Make sure a city's events were searched in the last day, without making
 * anyone wait for a 2-minute web search. The marker in searches/<slug> stops
 * two searches running at once, and backs off for an hour after a failure.
 * Only a city's very first search is waited for, and then at most `waitMs`.
 */
export async function ensureFresh(cityName, { now = new Date(), waitMs = 8000, refresh = refreshCityEvents } = {}) {
  const city = cityOrThrow(cityName);
  const marker = await get("searches", city.slug);
  const age = (iso) => (iso ? now - new Date(iso) : Infinity);
  const firstSearch = !marker?.lastSearchAt && !(await list("events", (e) => e.status === "found" && (e.city || "Lagos") === city.name)).length;
  const status = { lastSearchAt: marker?.lastSearchAt ?? null, refreshing: false, firstSearch };

  if (marker?.status === "done" && age(marker.lastSearchAt) < 24 * HOUR) return status;
  if (marker?.status === "running" && age(marker.startedAt) < 10 * 60_000) return { ...status, refreshing: true };
  if (marker?.status === "failed" && age(marker.startedAt) < HOUR) return status;

  let finished = false;
  const p = searchAndMark(city.name, { now, refresh, marker }).finally(() => { finished = true; });
  const running = background(p);
  if (firstSearch) await Promise.race([running, sleep(waitMs)]);
  if (finished) {
    const m = await get("searches", city.slug);
    return { lastSearchAt: m?.lastSearchAt ?? null, refreshing: false, firstSearch };
  }
  return { ...status, refreshing: true };
}

/**
 * Cities worth searching today: London and Lagos always, plus where people
 * have been active this week. At most 8, to keep the daily cost known.
 */
export async function activeCities({ now = new Date(), days = 7 } = {}) {
  const since = now.getTime() - days * 86400_000;
  const recent = (iso) => iso && new Date(iso).getTime() >= since;
  const out = ["London", "Lagos"];
  const add = (name) => { const c = cityNamed(name); if (c && !out.includes(c.name)) out.push(c.name); };
  for (const u of await list("users", (u) => u.city && (recent(u.updatedAt) || recent(u.createdAt)))) add(u.city);
  for (const c of await list("checkins", (c) => recent(c.at))) add(c.city || (c.venueLocation ? cityNear(c.venueLocation)?.name : null));
  return out.slice(0, 8);
}

