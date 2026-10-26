// Venue dashboard: folding under 3, local weekdays, ratings by taste, who to book.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const dir = mkdtempSync(join(tmpdir(), "outside-organiser-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_API_KEY = "test";

const SOUNDS = { A1: ["afrobeats", "R&B", "pop"], A2: ["jazz", "soul", "funk"], A3: ["metal", "rock", "punk"] };
let stub, org, store;
before(async () => {
  stub = await startQlooStub((path, params) => {
    if (path !== "/v2/insights") return { results: [] };
    const sig = String(params["signal.interests.entities"] || "").split(",");
    if (params["filter.type"] === "urn:tag") {
      if (params["filter.tag.types"] !== "urn:tag:genre:music") return { results: { tags: [] } };
      return { results: { tags: sig.flatMap((id) => SOUNDS[id] || []).map((name) => ({ name })) } };
    }
    if (params["filter.type"] === "urn:entity:artist") {
      return { results: { entities: [
        { entity_id: "A1", name: "Tems", query: { affinity: 0.99 } },
        { entity_id: "X1", name: "Ayra Starr", query: { affinity: 0.95 }, properties: { image: { url: "https://img/x1" } } },
        { entity_id: "X2", name: "Rema", query: { affinity: 0.912 } },
      ] } };
    }
    return { results: { entities: [] } };
  });
  process.env.QLOO_BASE_URL = stub.url;
  store = await import("../src/store.js");
  org = await import("../src/organiser.js");
});
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { await store.reset(); stub.calls.length = 0; });

const now = new Date("2026-10-25T12:00:00Z");
const fav = { A1: { id: "A1", name: "Tems", type: "artist" }, A2: { id: "A2", name: "Ezra Collective", type: "artist" }, A3: { id: "A3", name: "Metallica", type: "artist" } };
async function visitor(id, artist, at, extra = {}) {
  await store.put("users", { id, firstName: id, city: "London", favourites: [fav[artist]], visibility: "everyone", ...extra });
  await store.put("checkins", { id: `c-${id}-${at}`, userId: id, venueId: "V", venueName: "Jazz Cafe", city: "London", at, expiresAt: at });
}

test("fewer than 3 visitors gives a note only", async () => {
  await visitor("u1", "A1", "2026-10-23T22:30:00Z");
  await visitor("u2", "A1", "2026-10-23T22:30:00Z", { demo: true });
  const d = await org.venueDashboard({ venueId: "V", cityName: "London", now });
  assert.deepEqual(Object.keys(d).sort(), ["demoUsers", "note", "visitors"]);
  assert.equal(d.visitors, 2);
  assert.equal(d.demoUsers, 1);
});

test("weekdays in London time: Fri 23:30 and Sat 00:30 are different nights; small groups fold", async () => {
  // BST is UTC+1: 22:30Z is Fri 23:30, 23:30Z is Sat 00:30.
  for (const id of ["f1", "f2", "f3"]) await visitor(id, "A1", "2026-10-23T22:30:00Z");
  for (const id of ["s1", "s2"]) await visitor(id, "A1", "2026-10-23T23:30:00Z");
  await visitor("s3", "A2", "2026-10-23T23:30:00Z");
  const d = await org.venueDashboard({ venueId: "V", cityName: "London", now });
  const fri = d.byWeekday.find((x) => x.day === "Fri"), sat = d.byWeekday.find((x) => x.day === "Sat");
  assert.equal(d.visitors, 6);
  assert.equal(fri.checkins, 3);
  assert.equal(sat.checkins, 3);
  assert.deepEqual(fri.topLoves, { rows: [{ name: "Tems", people: 3 }], other: 0 });
  // Saturday: 2 Tems, 1 Ezra → both folded.
  assert.deepEqual(sat.topLoves, { rows: [], other: 3 });
  assert.deepEqual(sat.topSounds.rows, []);
  assert.deepEqual(fri.topSounds.rows.map((r) => r.name), ["Afrobeats", "R&B", "Pop"]);
  assert.equal(d.byWeekday.find((x) => x.day === "Mon").checkins, 0);
  assert.equal(org.weekdayIn("2026-10-23T22:30:00Z", "Europe/London"), "Fri");
  assert.equal(org.weekdayIn("2026-10-23T23:30:00Z", "Europe/London"), "Sat");
  assert.ok(!/f1|s3|firstName/.test(JSON.stringify(d)));
});

test("ratings by taste group fold groups under 3", async () => {
  const at = "2026-10-23T20:00:00Z";
  for (const [id, a, stars] of [["r1", "A1", 5], ["r2", "A1", 4], ["r3", "A1", 3], ["r4", "A2", 1]]) {
    await visitor(id, a, at);
    await store.put("reviews", { id: `${id}|V|d`, userId: id, placeId: "V", stars, note: "", at });
  }
  const d = await org.venueDashboard({ venueId: "V", cityName: "London", now });
  assert.deepEqual(d.ratings.overall, { avg: 3.3, count: 4 });
  assert.deepEqual(d.ratings.byTaste.map((g) => [g.group, g.avg, g.count]), [["Afrobeats", 4, 3], ["R&B", 4, 3], ["Pop", 4, 3]]);
  assert.deepEqual(d.ratings.other, { count: 3 }); // jazz, soul, funk: one reviewer each
});

test("who to book: signalled by the crowd's artists and the venue, minus artists they already love", async () => {
  for (const id of ["b1", "b2", "b3"]) await visitor(id, "A1", "2026-10-23T20:00:00Z");
  await visitor("b4", "A3", "2026-10-23T20:00:00Z");
  const d = await org.venueDashboard({ venueId: "V", cityName: "London", now });
  assert.deepEqual(d.bookNext.map((a) => a.name), ["Ayra Starr", "Rema"]);
  assert.deepEqual(d.bookNext[0], { id: "X1", name: "Ayra Starr", image: "https://img/x1", affinity: 95, because: ["Tems"] });
  const call = stub.calls.find((c) => c.params["filter.type"] === "urn:entity:artist");
  assert.equal(call.params["signal.interests.entities"], "A1,A3,V");
  assert.equal(call.params.take, "20");
});
