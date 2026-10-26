// Events for any city: the prompt, venue placing, per-city refresh and the
// once-a-day freshness marker. Qloo is stubbed; Claude is a fake client.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const stub = await startQlooStub((path, p) => {
  if (path !== "/search") return { results: {} };
  if (p.types === "urn:entity:artist") return { results: [{ entity_id: `art-${p.query.toLowerCase()}`, name: p.query }] };
  // The only venue Qloo "knows" is in Lagos, so a London search for it must not use it.
  if (p.query === "Faraway Hall") return { results: [{ entity_id: "lagos-hall", name: "Faraway Hall", location: { lat: 6.43, lon: 3.42 } }] };
  if (p.query === "Ronnie Scott's") return { results: [{ entity_id: "ronnie", name: "Ronnie Scott's", location: { lat: 51.5134, lon: -0.1317 } }] };
  return { results: [] };
});
const dir = mkdtempSync(join(tmpdir(), "outside-cityev-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";

const store = await import("../src/store.js");
const ce = await import("../src/city-events.js");
const { cityNamed } = await import("../src/cities.js");
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => store.reset());

const london = cityNamed("London"), lagos = cityNamed("Lagos");
const now = new Date("2026-10-30T12:00:00Z");
const SRC = "https://example.org/gig";

function fakeClient(events) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => {
      calls.push(params);
      return { stop_reason: "end_turn", usage: { input_tokens: 1 }, content: [
        { type: "web_search_tool_result", content: [{ url: SRC }] },
        { type: "text", text: JSON.stringify({ events }) },
      ] };
    } } },
  };
}
const gig = (o = {}) => ({ title: "Late Jazz", kind: "concert", starts: "2026-11-02T20:00:00Z", ends: null, venue_name: "Ronnie Scott's", area: "Soho", lineup: ["Ezra Collective"], source_url: SRC, ...o });

test("the prompt names the city and country; Detty December only for Lagos", () => {
  const p = ce.eventPrompt(london, "2026-10-30", now);
  assert.match(p, /London, United Kingdom/);
  assert.match(p, /UTC\+00:00/);
  assert.match(p, /next 14 days; up to 120/);
  assert.match(p, /anything outside London\./);
  assert.doesNotMatch(p, /Detty December/);
  assert.match(ce.eventPrompt(lagos, "2026-10-30", now), /Detty December events matter most/);
  assert.match(ce.eventPrompt(lagos, "2026-10-30", now), /UTC\+01:00/);
});

test("the web search is located in the city: country code and time zone", async () => {
  const client = fakeClient([]);
  await ce.searchCityEvents(london, { now, client });
  assert.deepEqual(client.calls[0].tools[0].user_location, { type: "approximate", city: "London", country: "GB", timezone: "Europe/London" });
  assert.match(client.calls[0].output_config.format.schema.properties.events.items.properties.area.description, /London/);
});

test("a venue Qloo doesn't know (or knows in another city) lands on the city centre, marked approximate", async () => {
  assert.deepEqual(await ce.placeVenue("Nowhere Club", "Soho", london), { lat: london.lat, lon: london.lon, approximate: true });
  assert.deepEqual(await ce.placeVenue("Faraway Hall", "Soho", london), { lat: london.lat, lon: london.lon, approximate: true });
  const known = await ce.placeVenue("Ronnie Scott's", "Soho", london);
  assert.equal(known.approximate, false);
  assert.equal(known.qlooId, "ronnie");
});

test("kept events carry their city and artists' Qloo ids; ids differ by city", async () => {
  const { kept } = await ce.vetEvents([gig()], new Set([SRC]), now, london);
  assert.equal(kept[0].city, "London");
  assert.deepEqual(kept[0].artistIds, { "Ezra Collective": "art-ezra collective" });
  assert.equal(kept[0].venue.qlooId, "ronnie");
  const lagosId = (await ce.vetEvents([gig({ venue_name: "Nowhere" })], new Set([SRC]), now, lagos)).kept[0].id;
  assert.notEqual(kept[0].id, lagosId);
});

test("a refresh expires only that city's past events", async () => {
  const past = { status: "found", starts: "2026-10-01T20:00:00Z", ends: "2026-10-01T23:00:00Z", title: "Old", venue: { lat: 0, lon: 0 } };
  await store.put("events", { ...past, id: "old-london", city: "London" });
  await store.put("events", { ...past, id: "old-lagos", city: "Lagos" });
  await store.put("events", { ...past, id: "old-legacy" }); // no city: Lagos
  const r = await ce.refreshCityEvents("London", { now, client: fakeClient([gig()]) });
  assert.equal(r.city, "London");
  assert.equal(r.kept, 1);
  assert.equal(r.expired, 1);
  assert.equal(r.total, 1);
  assert.ok(await store.get("events", "old-lagos"));
  assert.ok(await store.get("events", "old-legacy"));
  assert.equal(await store.get("events", "old-london"), null);
});

test("London's events never include Lagos's examples", async () => {
  const seededIds = new Set((await ce.eventsInCity("Lagos", { now })).map((e) => e.id));
  assert.ok(seededIds.has("ddf-2026-opening"));
  const londonIds = (await ce.eventsInCity("London", { now })).map((e) => e.id);
  assert.ok(londonIds.every((id) => !seededIds.has(id)));
});

/* ---------- ensureFresh ---------- */

const HOUR = 3600_000;
const tick = () => new Promise((r) => setTimeout(r, 20));
const later = (ms) => new Date(now.getTime() + ms);
function counter(impl = async () => ({ kept: 3 })) {
  const f = async (...a) => { f.calls++; return impl(...a); };
  f.calls = 0;
  return f;
}
const hasFound = () => store.put("events", { id: "x", status: "found", city: "London", title: "X", starts: later(48 * HOUR).toISOString(), ends: later(50 * HOUR).toISOString(), venue: {} });

test("ensureFresh: a search under a day old means no new search", async () => {
  await store.put("searches", { id: "london", status: "done", lastSearchAt: later(-HOUR).toISOString(), startedAt: later(-HOUR).toISOString() });
  const refresh = counter();
  const s = await ce.ensureFresh("London", { now, refresh });
  assert.equal(refresh.calls, 0);
  assert.equal(s.refreshing, false);
});

test("ensureFresh: stale returns at once while the search runs on", async () => {
  await hasFound();
  await store.put("searches", { id: "london", status: "done", lastSearchAt: later(-25 * HOUR).toISOString(), startedAt: later(-25 * HOUR).toISOString() });
  let release;
  const gate = new Promise((r) => (release = r));
  const refresh = counter(async () => { await gate; return { kept: 4 }; });
  const s = await ce.ensureFresh("London", { now, refresh });
  assert.equal(s.refreshing, true);
  assert.equal(s.firstSearch, false);
  await tick();
  assert.equal(refresh.calls, 1);
  assert.equal((await store.get("searches", "london")).status, "running");
  release();
  await tick();
  const m = await store.get("searches", "london");
  assert.equal(m.status, "done");
  assert.equal(m.lastSearchAt, now.toISOString());
  assert.equal(m.kept, 4);
});

test("ensureFresh: a city's first search is waited for, but at most waitMs", async () => {
  const slow = counter(() => new Promise(() => {}));
  const t = Date.now();
  const s = await ce.ensureFresh("London", { now, refresh: slow, waitMs: 60 });
  assert.ok(Date.now() - t < 1000);
  assert.equal(s.firstSearch, true);
  assert.equal(s.refreshing, true);

  await store.reset();
  const quick = counter();
  const q = await ce.ensureFresh("Paris", { now, refresh: quick, waitMs: 2000 });
  assert.equal(q.refreshing, false);
  assert.equal(q.lastSearchAt, now.toISOString());
});

test("ensureFresh: a running search stops a second one, unless it's over 10 minutes old", async () => {
  await hasFound();
  await store.put("searches", { id: "london", status: "running", startedAt: later(-2 * 60_000).toISOString(), lastSearchAt: null });
  const refresh = counter();
  assert.equal((await ce.ensureFresh("London", { now, refresh })).refreshing, true);
  assert.equal(refresh.calls, 0);
  await store.put("searches", { id: "london", status: "running", startedAt: later(-11 * 60_000).toISOString(), lastSearchAt: null });
  await ce.ensureFresh("London", { now, refresh });
  await tick();
  assert.equal(refresh.calls, 1);
});

test("ensureFresh: a failed search backs off for an hour", async () => {
  await hasFound();
  const errors = console.error;
  console.error = () => {};
  try {
    const failing = counter(async () => { throw new Error("search down"); });
    await ce.ensureFresh("London", { now, refresh: failing });
    await tick();
    const m = await store.get("searches", "london");
    assert.equal(m.status, "failed");
    assert.match(m.lastError, /search down/);
    await ce.ensureFresh("London", { now: later(30 * 60_000), refresh: failing });
    assert.equal(failing.calls, 1);
    await ce.ensureFresh("London", { now: later(61 * 60_000), refresh: failing });
    await tick();
    assert.equal(failing.calls, 2);
  } finally {
    console.error = errors;
  }
});

test("active cities: London and Lagos always, plus where people were this week, at most 8", async () => {
  assert.deepEqual(await ce.activeCities({ now }), ["London", "Lagos"]);
  await store.put("users", { city: "Paris", updatedAt: later(-2 * 24 * HOUR).toISOString() });
  await store.put("users", { city: "Tokyo", updatedAt: later(-30 * 24 * HOUR).toISOString() });
  await store.put("checkins", { userId: "u", city: "Berlin", at: later(-HOUR).toISOString() });
  assert.deepEqual(await ce.activeCities({ now }), ["London", "Lagos", "Paris", "Berlin"]);
  const names = ["Accra", "Nairobi", "Dubai", "Madrid", "Rome", "Seoul"];
  for (const n of names) await store.put("users", { city: n, updatedAt: now.toISOString() });
  const out = await ce.activeCities({ now });
  assert.equal(out.length, 8);
  assert.deepEqual(out.slice(0, 2), ["London", "Lagos"]);
  assert.ok(out.includes("Paris") && !out.includes("Tokyo"));
});
