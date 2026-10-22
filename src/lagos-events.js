/**
 * Finds real upcoming events in Lagos, once a day, for everyone.
 *
 * Qloo has no event listings, so Claude searches the web for them: concerts,
 * parties and festivals, each with a date, a venue and the artists on the
 * bill. Qloo then does the part that matters, scoring each lineup against each
 * visitor's taste (see events.js). Claude only finds; Qloo decides what fits.
 *
 * Nothing is taken on trust. An event is kept only if it has a title, a start
 * time in the next 120 days, at least one artist, and a source link that was
 * really among the pages the search returned. Venues are placed on the map
 * through Qloo when Qloo knows them, otherwise by area, and say so.
 */

import "./env.js";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { findEntity } from "./qloo.js";
import { LAGOS_AREAS, inLagos } from "./geo.js";
import { list, put, remove } from "./store.js";

const MODEL = "claude-opus-5-5";
const HORIZON_DAYS = 120;
const LAGOS_CENTRE = { lat: 6.4281, lon: 3.4219 };

const SCHEMA = {
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
          starts: { type: "string", description: "ISO 8601 with offset, e.g. 2026-12-18T18:00:00+01:00. If only the date is known, use 18:00 Lagos time." },
          ends: { type: ["string", "null"] },
          venue_name: { type: "string" },
          area: { type: "string", description: "Lagos area, e.g. Victoria Island, Lekki, Ikoyi, Ikeja, Lagos Island" },
          lineup: { type: "array", items: { type: "string" }, description: "Performing artists, DJs or comedians named by the source. Empty if none are named." },
          source_url: { type: "string", description: "The page the details came from." },
        },
      },
    },
  },
};

function prompt(today) {
  return `Today is ${today}. Find real, upcoming events in Lagos, Nigeria over the next ${HORIZON_DAYS} days: concerts, music festivals, parties with named DJs, and comedy shows. Detty December events matter most.

Search the web, then list each event once with its title, start date and time, venue, Lagos area, the artists, DJs or comedians named on the bill, and the link of the page you took the details from.

Rules:
- Only events whose date you found on a page. Never guess a date.
- Only names a source lists as performing. Never add artists who are merely rumoured.
- If a source names no performers, give an empty lineup.
- Use the event's own page or a news report as the source link.
- Skip past events, and anything outside Lagos.`;
}

const urlsSeen = (content) =>
  new Set(
    content
      .filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content))
      .flatMap((b) => b.content.map((r) => r.url))
      .filter(Boolean),
  );

/** Ask Claude to search and return events. Resumes long searches that pause. */
export async function searchLagosEvents({ now = new Date(), client = new Anthropic() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const messages = [{ role: "user", content: prompt(today) }];
  const seen = new Set();
  let response;

  for (let turn = 0; turn < 4; turn++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", city: "Lagos", timezone: "Africa/Lagos" } }],
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

/** Put a venue on the map: Qloo first, then the named area, then central Lagos. */
async function placeVenue(name, area) {
  const e = await findEntity(name, "urn:entity:place", { city: "Lagos" }).catch(() => null);
  if (e?.location && inLagos(e.location)) return { lat: e.location.lat, lon: e.location.lon, approximate: false, qlooId: e.entity_id };
  const a = LAGOS_AREAS[AREA_ALIASES[String(area).toLowerCase().trim()] || String(area).toLowerCase().trim()];
  if (a) return { lat: a.lat, lon: a.lon, approximate: true };
  return { ...LAGOS_CENTRE, approximate: true };
}

/** Keep only events that pass every check. Returns kept events and why others were dropped. */
export async function vetEvents(raw, sourcesSeen, now = new Date()) {
  const kept = [], dropped = [];
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
    const ends = ev.ends && !isNaN(new Date(ev.ends)) ? new Date(ev.ends) : new Date(starts.getTime() + 5 * 3600_000);
    const venue = await placeVenue(ev.venue_name, ev.area);
    kept.push({
      id: "found-" + createHash("sha1").update(`${ev.title.toLowerCase().trim()}|${starts.toISOString().slice(0, 10)}`).digest("hex").slice(0, 12),
      title: ev.title.trim().slice(0, 120),
      kind: ev.kind || "event",
      status: "found",
      starts: starts.toISOString(),
      ends: ends.toISOString(),
      venue: { name: String(ev.venue_name || "Venue").slice(0, 80), area: ev.area || null, ...venue },
      lineup,
      source: ev.source_url,
      foundAt: now.toISOString(),
    });
  }
  // The same event reported twice keeps its first sighting.
  const unique = [];
  for (const e of kept) if (!unique.some((u) => u.id === e.id)) unique.push(e);
  return { kept: unique, dropped };
}

/**
 * The daily job: search, vet, and add today's finds to the list. The web
 * search finds a slightly different set each day, so an event found once
 * stays until it has happened rather than vanishing overnight; a newer
 * sighting of the same event replaces the older one. Organiser-added events
 * are never touched.
 */
export async function refreshLagosEvents({ now = new Date(), client } = {}) {
  const { events, sourcesSeen, usage } = await searchLagosEvents({ now, client });
  const { kept, dropped } = await vetEvents(events, sourcesSeen, now);
  const old = await list("events", (e) => e.status === "found");
  let expired = 0;
  for (const e of old) {
    if (new Date(e.ends || e.starts) < now) { await remove("events", e.id); expired++; }
  }
  for (const e of kept) await put("events", e);
  const total = (await list("events", (e) => e.status === "found")).length;
  return { kept: kept.length, expired, total, dropped, usage };
}
