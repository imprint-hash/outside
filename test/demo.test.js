// Demo data: labelled, idempotent, and removable without touching real people.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const dir = mkdtempSync(join(tmpdir(), "outside-demo-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_API_KEY = "test";

const GENRES = { "Burna Boy": "afrobeats", Tems: "afrobeats", Wizkid: "afrobeats", Stormzy: "grime", Dave: "grime", "Ezra Collective": "jazz", "Kamasi Washington": "jazz", SZA: "r&b", "Jorja Smith": "r&b", "Fred again..": "house", "Peggy Gou": "house", "Arctic Monkeys": "indie" };
const idOf = (name) => `E-${name}`;
let stub, store, demo;
before(async () => {
  stub = await startQlooStub((path, params) => {
    if (path === "/search") {
      const loc = params.types === "urn:entity:place" ? { lat: 51.5 + Math.random() * 0.02, lon: -0.12 } : undefined;
      return { results: [{ entity_id: idOf(params.query), name: params.query, location: loc, properties: { address: "London" } }] };
    }
    if (path === "/v2/insights" && params["filter.type"] === "urn:tag") {
      if (params["filter.tag.types"] !== "urn:tag:genre:music") return { results: { tags: [] } };
      const ids = String(params["signal.interests.entities"]).split(",");
      return { results: { tags: Object.entries(GENRES).filter(([n]) => ids.includes(idOf(n))).map(([, g]) => ({ name: g })) } };
    }
    return { results: { entities: [] } };
  });
  process.env.QLOO_BASE_URL = stub.url;
  store = await import("../src/store.js");
  demo = await import("../src/demo.js");
});
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });

const now = new Date("2026-10-23T20:00:00+01:00");
const counts = async () => Object.fromEntries(await Promise.all(["users", "checkins", "reviews"].map(async (c) => [c, (await store.list(c)).length])));

test("seeding twice gives the same records; demo users are labelled", async () => {
  await store.reset();
  const real = await store.put("users", { id: "real-1", firstName: "Real", favourites: [], visibility: "everyone" });
  await store.put("checkins", { id: "real-c", userId: real.id, venueId: idOf("XOYO"), at: now.toISOString(), expiresAt: now.toISOString() });
  await store.put("reviews", { id: "real-r", userId: real.id, placeId: idOf("XOYO"), stars: 3, demo: false });

  const r1 = await demo.seedDemo({ cityName: "London", now });
  const first = await counts();
  const r2 = await demo.seedDemo({ cityName: "London", now: new Date(now.getTime() + 3600_000) });
  assert.deepEqual(await counts(), first);
  assert.deepEqual(first, { users: 12, checkins: 11, reviews: 13 });
  assert.equal(r1.users, 10);
  assert.equal(r1.reviews, 12);
  assert.equal(r2.checkins, 10);
  assert.deepEqual(r1.missing, {});

  const demoUsers = await store.list("users", (u) => u.demo === true);
  assert.equal(demoUsers.length, 11);
  for (const u of demoUsers) {
    assert.ok(u.firstName.startsWith("Demo · "), u.firstName);
    assert.ok(u.id.startsWith("demo-"));
    assert.ok(u.email.endsWith("@demo.outside.invalid"));
  }
  const org = await store.get("users", "demo-venue");
  assert.equal(org.role, "organiser");
  assert.equal(org.venueId, idOf("Jazz Cafe Camden"));
  // At least 3 people at two venues.
  const perVenue = {};
  for (const c of await store.list("checkins", (c) => c.demo)) perVenue[c.venueName] = (perVenue[c.venueName] || 0) + 1;
  assert.ok(Object.values(perVenue).filter((n) => n >= 3).length >= 2, JSON.stringify(perVenue));

  // The matrix is square and symmetric; same tastes match more than different ones.
  const { slugs, rows } = r2.matrix;
  assert.equal(rows.length, 10);
  const at = (a, b) => rows[slugs.indexOf(a)][slugs.indexOf(b)];
  assert.equal(at("amara", "tolu"), at("tolu", "amara"));
  assert.ok(at("amara", "tolu") > at("amara", "olly"));
  assert.match(demo.formatMatrix(r2.matrix), /amara/);
});

test("renew re-checks-in demo users; removeDemo leaves real people alone", async () => {
  const later = new Date(now.getTime() + 7 * 86400_000); // Fri 30 Oct, after the clocks go back
  assert.equal(await demo.renewDemoCheckins(later), 10);
  const c = await store.get("checkins", "demo-amara-checkin");
  assert.ok(new Date(c.expiresAt) > later);
  assert.equal(new Date(c.expiresAt).toISOString(), "2026-10-31T06:00:00.000Z"); // 06:00 GMT Sat 31 Oct

  await store.put("hellos", { id: "h1", from: "demo-amara", to: "real-1", status: "pending" });
  const removed = await demo.removeDemo();
  assert.deepEqual(removed, { users: 11, checkins: 10, hellos: 1, reviews: 12 });
  assert.deepEqual(await counts(), { users: 1, checkins: 1, reviews: 1 });
  assert.ok(await store.get("users", "real-1"));
});
