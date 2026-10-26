// Safety rules that depend on time passing, checked offline by moving the clock.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "outside-rules-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
let store, people;
before(async () => {
  store = await import("../src/store.js");
  people = await import("../src/people.js");
});
after(() => rmSync(dir, { recursive: true, force: true }));

const t0 = new Date("2026-12-18T23:00:00+01:00");
const plus = (min) => new Date(t0.getTime() + min * 60_000);
const venue = { lat: 6.438, lon: 3.4381 };

async function twoPeopleAtQuilox() {
  await store.reset();
  const a = await store.put("users", { firstName: "A", favourites: [], visibility: "everyone" });
  const b = await store.put("users", { firstName: "B", favourites: [], visibility: "everyone" });
  for (const u of [a, b]) await store.put("checkins", { userId: u.id, venueId: "Q", venueName: "Quilox", venueLocation: venue, verified: true, at: t0.toISOString(), expiresAt: new Date("2026-12-19T06:00:00+01:00").toISOString() });
  const h = await store.put("hellos", { from: a.id, to: b.id, venueId: "Q", venueName: "Quilox", status: "accepted", at: t0.toISOString() });
  return { a, b, h };
}

test("meet-up mode switches itself off after 30 minutes", async () => {
  const { a, b, h } = await twoPeopleAtQuilox();
  await people.startMeetup(a, h.id, t0);
  const live = await people.startMeetup(b, h.id, plus(1));
  assert.equal(live.status, "live");
  await people.updatePosition(a, live.meetupId, venue, plus(10));
  const at29 = await people.getMeetup(b, live.meetupId, plus(30));
  assert.equal(at29.status, "live");
  const at32 = await people.getMeetup(b, live.meetupId, plus(32));
  assert.equal(at32.status, "ended");
  assert.equal(at32.endedReason, "time");
  assert.equal(at32.them, null);
  await assert.rejects(people.updatePosition(a, live.meetupId, venue, plus(33)), /ended/);
});

test("a location older than 2 minutes is not shown", async () => {
  const { a, b, h } = await twoPeopleAtQuilox();
  await people.startMeetup(a, h.id, t0);
  const m = await people.startMeetup(b, h.id, t0);
  await people.updatePosition(a, m.meetupId, venue, plus(1));
  assert.ok((await people.getMeetup(b, m.meetupId, plus(2))).them);
  assert.equal((await people.getMeetup(b, m.meetupId, plus(4))).them, null);
});

test("check-ins expire at 6am: nobody is 'here' the next morning", async () => {
  const { a } = await twoPeopleAtQuilox();
  assert.equal((await people.whoIsHere(a, plus(60))).people.length, 1);
  await assert.rejects(people.whoIsHere(a, new Date("2026-12-19T06:30:00+01:00")), /Check in somewhere first/);
});

test("no more than 10 hellos an hour", async () => {
  await store.reset();
  const me = await store.put("users", { firstName: "Me", favourites: [], visibility: "everyone" });
  await store.put("checkins", { userId: me.id, venueId: "Q", venueName: "Quilox", venueLocation: venue, verified: true, at: t0.toISOString(), expiresAt: new Date("2026-12-19T06:00:00+01:00").toISOString() });
  const others = [];
  for (let i = 0; i < 11; i++) {
    const u = await store.put("users", { firstName: `P${i}`, favourites: [], visibility: "everyone" });
    await store.put("checkins", { userId: u.id, venueId: "Q", venueName: "Quilox", venueLocation: venue, verified: true, at: t0.toISOString(), expiresAt: new Date("2026-12-19T06:00:00+01:00").toISOString() });
    others.push(u);
  }
  for (let i = 0; i < 10; i++) await people.sayHi(me, others[i].id, plus(i));
  await assert.rejects(people.sayHi(me, others[10].id, plus(11)), /a lot of hellos/);
  await people.sayHi(me, others[10].id, plus(75)); // an hour later it's fine
});

test("an unverified check-in sees counts and faces, not names, and can't say hi", async () => {
  const { a, b } = await twoPeopleAtQuilox();
  const mine = (await store.list("checkins", (c) => c.userId === a.id))[0];
  await store.put("checkins", { ...mine, verified: false });
  const here = await people.whoIsHere(a, plus(5));
  assert.equal(here.verified, false);
  assert.deepEqual(here.people, []);
  assert.equal(here.here, 1);
  assert.equal(here.faces.length, 1);
  assert.ok(!JSON.stringify(here).includes(b.id) && !JSON.stringify(here).includes('"B"'));
  assert.match(here.note, /Share your location/);
  await assert.rejects(people.sayHi(a, b.id, plus(6)), (e) => e.status === 403 && /Share your location/.test(e.message));
});

test("chat is closed until they accept, and declined stays closed", async () => {
  const { a, b, h } = await twoPeopleAtQuilox();
  await store.put("hellos", { ...h, status: "pending" });
  await assert.rejects(people.sendMessage(a, h.id, "hi", t0), /after they say yes/);
  await people.answerHi(b, h.id, false, t0);
  await assert.rejects(people.sendMessage(a, h.id, "hi", t0), /after they say yes/);
  await assert.rejects(people.answerHi(b, h.id, true, t0), /already answered/);
});
