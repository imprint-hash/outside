// The Tonight map: time windows, filters, check-in venues, city separation. Qloo is stubbed.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const DISHOOM = { entity_id: "dishoom", name: "Dishoom Shoreditch", location: { lat: 51.5245, lon: -0.0768 }, query: { affinity: 0.9 }, properties: {}, tags: [] };
const stub = await startQlooStub((path, p) => {
  if (path === "/v2/insights" && p["filter.type"] === "urn:entity:place" && p["filter.location"]) return { results: { entities: [DISHOOM] } };
  return { results: { entities: [], tags: [] } };
});
const dir = mkdtempSync(join(tmpdir(), "outside-map-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";

const store = await import("../src/store.js");
const { timeWindow, kindsFor, eventInWindow, mapFor } = await import("../src/map.js");
const { seededEvents } = await import("../src/events.js");
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => store.reset());

const TZ = "Europe/London";
const ev = (starts, ends) => ({ starts, ends });

test("London 'tonight' runs to 06:00 local, across midnight, in winter and summer time", () => {
  const w = timeWindow("tonight", new Date("2026-10-30T23:30:00Z"), TZ);
  assert.equal(w.to.toISOString(), "2026-10-31T06:00:00.000Z");
  assert.equal(w.placeRule, "openSoon");
  assert.ok(eventInWindow(ev("2026-10-31T00:30:00Z", "2026-10-31T04:00:00Z"), w));
  assert.ok(!eventInWindow(ev("2026-10-31T07:00:00Z", "2026-10-31T10:00:00Z"), w));
  assert.ok(!eventInWindow(ev("2026-10-30T19:00:00Z", "2026-10-30T23:00:00Z"), w), "already over");
  assert.equal(timeWindow("tonight", new Date("2026-10-31T01:00:00Z"), TZ).to.toISOString(), "2026-10-31T06:00:00.000Z");
  assert.equal(timeWindow("tonight", new Date("2026-07-10T22:30:00Z"), TZ).to.toISOString(), "2026-07-11T05:00:00.000Z");
});

test("'now' is what's running; 'week' is seven days with no hours rule; bad values are 400", () => {
  const at = new Date("2026-10-30T21:00:00Z");
  const now = timeWindow("now", at, TZ);
  assert.equal(now.placeRule, "openNow");
  assert.ok(eventInWindow(ev("2026-10-30T20:00:00Z", "2026-10-30T23:00:00Z"), now));
  assert.ok(!eventInWindow(ev("2026-10-30T22:00:00Z", "2026-10-30T23:00:00Z"), now));
  const week = timeWindow("week", at, TZ);
  assert.equal(week.placeRule, "any");
  assert.ok(eventInWindow(ev("2026-11-05T20:00:00Z", "2026-11-05T23:00:00Z"), week));
  assert.ok(!eventInWindow(ev("2026-11-07T22:00:00Z", "2026-11-07T23:00:00Z"), week));
  assert.throws(() => timeWindow("someday", at, TZ), (e) => e.status === 400);
});

test("filters map to Qloo place kinds and event kinds", () => {
  const fd = kindsFor("food,drinks");
  assert.deepEqual(fd.places, ["restaurant", "bar", "lounge"]);
  assert.equal(fd.events.size, 0);
  const c = kindsFor(["comedy"]);
  assert.deepEqual(c.places, []);
  assert.deepEqual([...c.events], ["comedy"]);
  assert.deepEqual([...kindsFor("music").events], ["concert", "festival", "party", "other"]);
  assert.equal(kindsFor().kinds.length, 4);
  assert.throws(() => kindsFor("food,karaoke"), (e) => e.status === 400 && /karaoke/.test(e.message));
});

test("a venue with check-ins shows even when Qloo's list misses it; Lagos examples never show in London", async () => {
  const now = new Date("2026-10-30T21:00:00Z");
  await store.put("searches", { id: "london", status: "done", lastSearchAt: now.toISOString(), startedAt: now.toISOString() });
  await store.put("events", { id: "found-ldn", city: "London", status: "found", kind: "concert", title: "Late Jazz", starts: "2026-10-30T22:00:00Z", ends: "2026-10-31T01:00:00Z", venue: { name: "Ronnie Scott's", lat: 51.5134, lon: -0.1317, qlooId: "ronnie" }, lineup: ["Ezra Collective"], artistIds: { "Ezra Collective": "art-ezra" } });
  const viewer = await store.put("users", { firstName: "V", city: "London", favourites: [{ id: "fav-v", name: "Mine" }], visibility: "everyone" });
  const other = await store.put("users", { firstName: "O", city: "London", favourites: [{ id: "fav-o", name: "Theirs" }], visibility: "everyone" });
  await store.put("checkins", { userId: other.id, city: "London", venueId: "ronnie", venueName: "Ronnie Scott's", venueLocation: { lat: 51.5134, lon: -0.1317 }, at: now.toISOString(), expiresAt: "2026-10-31T06:00:00Z" });

  const m = await mapFor(viewer, { when: "tonight", now });
  assert.equal(m.city.name, "London");
  assert.deepEqual(m.origin, { lat: 51.5072, lon: -0.1276, label: "Central London" });
  const ids = m.venues.map((v) => v.id);
  assert.ok(ids.includes("dishoom"));
  const ronnie = m.venues.find((v) => v.id === "ronnie");
  assert.equal(ronnie.match, null);
  assert.equal(ronnie.crowd.here, 1);
  assert.deepEqual(m.venues.find((v) => v.id === "dishoom").crowd, { here: 0, likeYou: 0, strong: 0, plumbob: null });

  const seeded = new Set(seededEvents().map((e) => e.id));
  assert.ok(m.events.length >= 1);
  assert.ok(m.events.every((e) => !seeded.has(e.id)));
  const gig = m.events.find((e) => e.id === "found-ldn");
  assert.equal(gig.eventKind, "concert");
  assert.equal(gig.crowd.here, 1);
  assert.equal(m.eventsStatus.refreshing, false);
  // No artist search was needed: the event carried its ids.
  assert.ok(!stub.calls.some((c) => c.path === "/search"));

  const food = await mapFor(viewer, { when: "tonight", kinds: "food", now });
  assert.equal(food.events.length, 0);
});
