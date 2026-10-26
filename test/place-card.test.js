// The place card: Qloo's review data trimmed, our ratings, the crowd, rides.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const dir = mkdtempSync(join(tmpdir(), "outside-card-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_API_KEY = "test";

const long = "The staff are warm and quick. Drinks arrive fast. Tables turn slowly on weekends. Nobody minds.";
const FULL = {
  entity_id: "P1",
  name: "Dishoom Shoreditch",
  location: { lat: 51.5246, lon: -0.0768 },
  properties: {
    business_rating: 4.64,
    keywords: [
      { name: "black daal", count: 900 }, { name: "food", count: 5000 }, { name: "service", count: 4000 },
      { name: "chai", count: 800 }, { name: "queue", count: 700 }, { name: "bacon naan", count: 600 },
      { name: "cocktails", count: 500 }, { name: "decor", count: 400 }, { name: "breakfast", count: 300 },
      { name: "okra fries", count: 200 }, { name: "rare", count: 2 }, { name: "vibe", count: 100 }, { name: "biryani", count: 50 },
    ],
    service_description: long,
    ambience_description: `${"Bombay café ".repeat(30).trim()}.`,
    customer_demographics_description: "Groups of friends and families.",
    specialty_dishes: [{ name: "Black Daal" }, { name: "Bacon Naan Roll" }],
  },
};
const SLIM = { entity_id: "P2", name: "Slim Bar", location: { lat: 51.51, lon: -0.13 }, properties: { business_rating: 4.1 } };

let stub, card, store;
before(async () => {
  stub = await startQlooStub((path, params) => {
    if (path === "/v2/insights") return { results: { entities: params["filter.results.entities"] === "P1" ? [FULL] : [] } };
    if (path === "/entities") return { results: params.entity_ids === "P2" ? [SLIM] : [] };
    return { results: [] };
  });
  process.env.QLOO_BASE_URL = stub.url;
  store = await import("../src/store.js");
  card = await import("../src/place-card.js");
});
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { await store.reset(); });

const now = new Date("2026-10-23T21:00:00+01:00");
const viewer = { id: "v", firstName: "V", city: "London", favourites: [], visibility: "everyone" };

test("summaries are cut to two sentences or 220 characters; 8 keywords, empty words dropped", async () => {
  const c = await card.placeCard(viewer, "P1", { now, match: "87" });
  assert.equal(c.qloo.rating, 4.6);
  assert.equal(c.qloo.summaries.service, "The staff are warm and quick. Drinks arrive fast.");
  assert.ok(c.qloo.summaries.ambience.length <= 220 && c.qloo.summaries.ambience.endsWith("…"));
  assert.equal(c.qloo.summaries.crowd, "Groups of friends and families.");
  assert.equal(c.qloo.summaries.overall, null);
  assert.deepEqual(c.qloo.summaries.dishes, ["Black Daal", "Bacon Naan Roll"]);
  assert.deepEqual(c.qloo.keywords.map((k) => k.text), ["black daal", "chai", "queue", "bacon naan", "cocktails", "decor", "breakfast", "okra fries"]);
  assert.deepEqual(c.fit, { match: 87, label: "Strong match" });
  assert.equal(c.place.name, "Dishoom Shoreditch");
  assert.equal(c.place.city, "London");
  assert.ok(c.ride.uber.includes("dropoff[nickname]=Dishoom%20Shoreditch"));
  assert.equal(c.ride.bolt, "https://bolt.eu/");
});

test("falls back to /entities; missing fields are null; no match given means null fit", async () => {
  const c = await card.placeCard(viewer, "P2", { now });
  assert.equal(c.qloo.rating, 4.1);
  assert.deepEqual(c.qloo.keywords, []);
  assert.deepEqual(c.qloo.summaries, { service: null, ambience: null, crowd: null, overall: null, dishes: null });
  assert.deepEqual(c.fit, { match: null, label: null });
  assert.ok(stub.calls.some((x) => x.path === "/entities"));
  await assert.rejects(card.placeCard(viewer, "NOPE", { now }), (e) => e.status === 404);
});

test("crowd, our ratings and what you can do", async () => {
  const at = now.toISOString(), exp = new Date("2026-10-24T06:00:00+01:00").toISOString();
  await store.put("users", { id: "o", firstName: "Other", favourites: [], visibility: "everyone" });
  await store.put("checkins", { userId: "o", venueId: "P1", venueName: "Dishoom", venueLocation: FULL.location, city: "London", at, expiresAt: exp });
  await store.put("checkins", { userId: "v", venueId: "P1", venueName: "Dishoom", venueLocation: FULL.location, city: "London", verified: true, at, expiresAt: exp });
  await store.put("reviews", { id: "o|P1|2026-10-23", userId: "o", placeId: "P1", stars: 4, note: "Get the daal", at });
  const c = await card.placeCard(viewer, "P1", { now, origin: { lat: 51.52, lon: -0.08 } });
  assert.equal(c.crowd.here, 1);
  assert.equal(c.crowd.likeYou, 0);
  assert.deepEqual(c.you, { checkedInHere: true, verifiedHere: true, canSayHi: true, canReview: true, reviewedToday: false });
  assert.deepEqual(c.ours.overall, { avg: 4, count: 1 });
  assert.equal(c.ours.notes[0].note, "Get the daal");
  assert.ok(c.place.trip);
  assert.ok(!/firstName|"Other"|"userId"/.test(JSON.stringify(c)));
});
