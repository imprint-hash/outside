// "How was it?": who may rate, once a day, short plain notes, and the two ratings.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "outside-reviews-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_API_KEY = "test";
let store, reviews;
before(async () => {
  store = await import("../src/store.js");
  reviews = await import("../src/reviews.js");
});
after(() => rmSync(dir, { recursive: true, force: true }));

// Fri 23 Oct 2026, 21:00 in London (BST, UTC+1).
const t0 = new Date("2026-10-23T21:00:00+01:00");
const hours = (h) => new Date(t0.getTime() + h * 3600_000);
const user = { id: "u1", firstName: "Ada", city: "London" };
const ronnie = { lat: 51.5133, lon: -0.1318 };

async function checkedIn(at = t0, venueId = "P1") {
  await store.put("checkins", { userId: user.id, venueId, venueName: "Ronnie Scott's", venueLocation: ronnie, city: "London", at: at.toISOString(), expiresAt: hours(9).toISOString() });
}

beforeEach(async () => { await store.reset(); });

test("no check-in there means no review", async () => {
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4, note: "" }, t0), (e) => e.status === 403 && /Check in there first/.test(e.message));
  await checkedIn(t0, "OTHER");
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4 }, t0), (e) => e.status === 403);
});

test("a check-in 49 hours ago is too old; 47 hours is fine", async () => {
  await checkedIn(t0);
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4 }, hours(49)), (e) => e.status === 403);
  const r = await reviews.addReview(user, { placeId: "P1", stars: 4, note: "  Great   band \u0007 " }, hours(47));
  assert.equal(r.note, "Great band");
  assert.equal(r.city, "London");
  assert.equal(r.placeName, "Ronnie Scott's");
  assert.equal(r.demo, false);
});

test("once per local day: same day 409, next London day OK", async () => {
  await checkedIn(t0);
  const first = await reviews.addReview(user, { placeId: "P1", stars: 5 }, t0);
  assert.equal(first.day, "2026-10-23");
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 3 }, hours(2.5)), (e) => e.status === 409); // 23:30 London
  const next = await reviews.addReview(user, { placeId: "P1", stars: 3 }, hours(3.5)); // 00:30 Sat London
  assert.equal(next.day, "2026-10-24");
});

test("stars 1 to 5 only; 141 characters or a link is refused", async () => {
  await checkedIn(t0);
  for (const stars of [0, 6, 3.5, "x"]) await assert.rejects(reviews.addReview(user, { placeId: "P1", stars }, t0), (e) => e.status === 400);
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4, note: "a".repeat(141) }, t0), (e) => e.status === 400);
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4, note: "see https://x.example" }, t0), (e) => e.status === 400 && /links/.test(e.message));
  await assert.rejects(reviews.addReview(user, { placeId: "P1", stars: 4, note: "go to www.spam.com" }, t0), (e) => e.status === 400);
  const ok = await reviews.addReview(user, { placeId: "P1", stars: 4, note: "a".repeat(140) }, t0);
  assert.equal(ok.note.length, 140);
});

test("pending: recent check-ins not yet rated", async () => {
  await checkedIn(t0, "P1");
  await checkedIn(hours(1), "P2");
  await checkedIn(hours(-50), "P3");
  assert.deepEqual((await reviews.pendingReviews(user, hours(2))).map((p) => p.placeId), ["P2", "P1"]);
  await reviews.addReview(user, { placeId: "P1", stars: 4 }, hours(2));
  assert.deepEqual((await reviews.pendingReviews(user, hours(2))).map((p) => p.placeId), ["P2"]);
});

test("summarize: weighted 'like you' average, own review left out, no names", () => {
  const rs = [
    { userId: "me", stars: 1, note: "mine", at: "1" },
    { userId: "a", stars: 5, note: "Loved it", at: "2", firstName: "Secret" },
    { userId: "b", stars: 3, note: "Fine", at: "3" },
    { userId: "c", stars: 1, note: "Too loud", at: "4" },
    { userId: "d", stars: 2, note: "", at: "5" },
  ];
  const sims = { a: { match: 100, because: "Loves Tems · Afrobeats" }, b: 70, c: 49, d: null, me: 100 };
  const s = reviews.summarize(rs, { viewerId: "me", similarity: (r) => sims[r.userId] });
  assert.deepEqual(s.overall, { avg: 2.4, count: 5 });
  // w(a) = 1, w(b) = 0.5 → (5 + 1.5) / 1.5 = 4.33
  assert.deepEqual(s.likeYou, { avg: 4.3, count: 2, enough: true });
  assert.deepEqual(s.notes.map((n) => n.note), ["Loved it", "Fine", "Too loud"]);
  assert.equal(s.notes[0].because, "Loves Tems · Afrobeats");
  const text = JSON.stringify(s);
  assert.ok(!/Secret|"userId"|firstName|"me"/.test(text));
  const one = reviews.summarize(rs.slice(0, 2), { viewerId: "me", similarity: (r) => sims[r.userId] });
  assert.equal(one.likeYou.enough, false);
  assert.deepEqual(reviews.summarize([], {}).likeYou, { avg: null, count: 0, enough: false });
});
