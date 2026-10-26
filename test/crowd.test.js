// "People like you" counts on the map: thresholds, privacy, faces. Qloo is stubbed.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

// Each person loves one thing, "<id>". The viewer's music set is t0..t99;
// person pN's is t0..t(N-1), so their match with the viewer is exactly N.
const tagsFor = (fav) => {
  const n = fav === "fav-viewer" ? 100 : Number(fav.replace("fav-p", ""));
  return Array.from({ length: n }, (_, i) => ({ name: `t${i}` }));
};
const stub = await startQlooStub((path, p) => {
  if (path !== "/v2/insights") return { results: [] };
  if (p["filter.type"] === "urn:tag" && p["filter.tag.types"] === "urn:tag:genre:music") return { results: { tags: tagsFor(p["signal.interests.entities"]) } };
  return { results: { tags: [], entities: [] } };
});
const dir = mkdtempSync(join(tmpdir(), "outside-crowd-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";

const store = await import("../src/store.js");
const { crowdAt, LIKE_YOU } = await import("../src/crowd.js");
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });

const now = new Date("2026-10-30T22:00:00Z");
const expiresAt = "2026-10-31T06:00:00Z";
const LONDON = { lat: 51.513, lon: -0.131 };

let viewer;
async function person(n, { visibility = "everyone", venueId = "ronnie", city = "London", firstName = `Name${n}` } = {}) {
  const u = await store.put("users", { firstName, favourites: [{ id: `fav-p${n}`, name: `Thing ${n}` }], visibility, avatar: { skin: `#${n}` } });
  await store.put("checkins", { userId: u.id, venueId, venueName: venueId, venueLocation: LONDON, ...(city ? { city } : {}), at: now.toISOString(), expiresAt });
  return u;
}
beforeEach(async () => {
  await store.reset();
  viewer = await store.put("users", { firstName: "Viewer", favourites: [{ id: "fav-viewer", name: "Mine" }], visibility: "everyone" });
});

test("threshold edges: 49 isn't like you, 50 is, 60 is strong", async () => {
  assert.equal(LIKE_YOU, 50);
  await person(49); await person(50); await person(60);
  const v = (await crowdAt(viewer, null, { now, cityName: "London" })).get("ronnie");
  assert.equal(v.here, 3);
  assert.equal(v.likeYou, 2);
  assert.equal(v.strong, 1);
  assert.equal(v.plumbob, "strong");
});

test("plumbob colours: okay for like-you only, null for nobody like you", async () => {
  await person(55, { venueId: "jazz" });
  await person(20, { venueId: "xoyo" });
  const m = await crowdAt(viewer, null, { now, cityName: "London" });
  assert.equal(m.get("jazz").plumbob, "okay");
  assert.equal(m.get("xoyo").plumbob, null);
  assert.equal(m.get("xoyo").here, 1);
});

test("people who chose nobody, and blocked people, aren't counted", async () => {
  await person(70, { visibility: "nobody" });
  const b = await person(80);
  await store.put("blocks", { by: b.id, who: viewer.id, at: now.toISOString() });
  await person(65);
  const v = (await crowdAt(viewer, null, { now, cityName: "London" })).get("ronnie");
  assert.equal(v.here, 1);
  assert.equal(v.strong, 1);
});

test("only the city asked for, legacy check-ins placed by location, and venueIds filter", async () => {
  await person(60, { city: null }); // legacy row, located in London
  await person(60, { city: "Lagos", venueId: "quilox" });
  await person(60, { venueId: "jazz" });
  const all = await crowdAt(viewer, null, { now, cityName: "London" });
  assert.deepEqual([...all.keys()].sort(), ["jazz", "ronnie"]);
  const one = await crowdAt(viewer, ["jazz"], { now, cityName: "London" });
  assert.deepEqual([...one.keys()], ["jazz"]);
});

test("no names or user ids anywhere in the output, faces included", async () => {
  const people = [await person(60, { firstName: "Zainab" }), await person(50, { firstName: "Kofi" })];
  const out = JSON.stringify([...(await crowdAt(viewer, null, { now, cityName: "London", faces: true })).values()]);
  for (const u of people) {
    assert.ok(!out.includes(u.id), "user id leaked");
    assert.ok(!out.includes(u.firstName), "name leaked");
  }
  assert.ok(!/firstName|userId/.test(out));
});

test("faces respect strong and verified visibility; invisible viewers see counts only", async () => {
  await person(50, { visibility: "strong" }); // counted, not shown
  await person(60, { visibility: "strong" }); // shown
  await person(90, { visibility: "verified" }); // shown only to verified viewers
  await person(55, { visibility: "groups" }); // counted, never shown one-to-one
  let v = (await crowdAt(viewer, null, { now, cityName: "London", faces: true })).get("ronnie");
  assert.equal(v.here, 4);
  assert.deepEqual(v.faces.map((f) => f.match), [60]);
  v = (await crowdAt({ ...viewer, verified: true }, null, { now, cityName: "London", faces: true })).get("ronnie");
  assert.deepEqual(v.faces.map((f) => f.match), [90, 60]);
  v = (await crowdAt({ ...viewer, visibility: "nobody" }, null, { now, cityName: "London", faces: true })).get("ronnie");
  assert.equal(v.here, 4);
  assert.deepEqual(v.faces, []);
});
