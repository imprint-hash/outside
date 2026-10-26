// End to end, through the HTTP API, against the real Qloo API.
// Runs only with LIVE=1 (npm run test:live): it makes real Qloo calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIVE = process.env.LIVE === "1";
// FLOW_STORE=supabase runs against the hosted database; test accounts are
// tagged with this run's id and deleted afterwards.
const HOSTED = process.env.FLOW_STORE === "supabase";
const RUN = Date.now().toString(36);
const dir = mkdtempSync(join(tmpdir(), "outside-"));
if (!HOSTED) process.env.OUTSIDE_STORE = join(dir, "store.json");

let server, base;
before(async () => {
  if (!LIVE) return;
  const { createServer } = await import("node:http");
  const { handle } = await import("../src/router.js");
  server = createServer((req, res) => handle(req, res));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
  if (HOSTED && LIVE) {
    const { list, remove } = await import("../src/store.js");
    const ids = new Set(Object.values(U).filter(Boolean));
    const mine = (r) => ids.has(r.id) || ids.has(r.userId) || ids.has(r.from) || ids.has(r.to) || ids.has(r.by) || ids.has(r.who) || ids.has(r.ownerId) || (r.users || []).some((u) => ids.has(u));
    for (const c of ["users", "checkins", "hellos", "messages", "meetups", "blocks", "reports", "events"]) {
      for (const r of await list(c, mine)) await remove(c, r.id);
    }
    for (const r of await list("users", (u) => u.email?.endsWith(`+${RUN}@test.dev`))) await remove("users", r.id);
  }
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

const PW = `pw-${RUN}-long-enough`;
let QUILOX_AT = {}; // the venue's own location, for verified check-ins
const T = {}; // tokens
const U = {}; // user ids
const people = {
  me: { email: `me+${RUN}@test.dev`, firstName: "Ife", homeCity: "Houston", taste: [["artist", "Tems"], ["artist", "SZA"], ["artist", "Burna Boy"], ["place", "Nobu Hotel London Shoreditch"]] },
  julie: { email: `julie+${RUN}@test.dev`, firstName: "Julie", homeCity: "Atlanta", taste: [["artist", "Ayra Starr"], ["artist", "Summer Walker"], ["artist", "Wizkid"], ["artist", "Tems"]] },
  bob: { email: `bob+${RUN}@test.dev`, firstName: "Bob", homeCity: "London", visibility: "strong", taste: [["artist", "Metallica"], ["artist", "Slayer"], ["artist", "Megadeth"]] },
  kemi: { email: `kemi+${RUN}@test.dev`, firstName: "Kemi", homeCity: "Houston", visibility: "verified", taste: [["artist", "Tems"], ["artist", "Rema"]] },
  dayo: { email: `dayo+${RUN}@test.dev`, firstName: "Dayo", homeCity: "Houston", visibility: "groups", taste: [["artist", "Wizkid"], ["artist", "Tems"], ["artist", "Burna Boy"]] },
  zee: { email: `zee+${RUN}@test.dev`, firstName: "Zee", homeCity: "London", visibility: "nobody", taste: [["artist", "Tems"], ["artist", "SZA"]] },
};

test("the whole night, end to end", { skip: !LIVE, timeout: 600_000 }, async (t) => {
  await t.test("health, and bad requests answer JSON with a reason", async () => {
    assert.equal((await call("GET", "/api/health")).ok, true);
    const nope = await call("GET", "/api/me", { token: "junk.token" });
    assert.equal(nope.status, 401);
    assert.match(nope.error, /sign in|session/i);
    assert.equal((await call("GET", "/api/nowhere")).status, 404);
    assert.equal((await call("POST", "/api/auth/signup", { body: { email: "not-an-email", password: PW, firstName: "X" } })).status, 400);
  });

  await t.test("sign up, and picks wait until you've added your taste", async () => {
    for (const [k, p] of Object.entries(people)) {
      const r = await call("POST", "/api/auth/signup", { body: { email: p.email, password: PW, firstName: p.firstName, homeCity: p.homeCity } });
      assert.equal(r.status, 200, r.error);
      T[k] = r.token;
      U[k] = r.user.id;
    }
    const again = await call("POST", "/api/auth/signup", { body: { email: `ME+${RUN}@test.dev`, password: PW } });
    assert.equal(again.returning, true);
    assert.equal((await call("POST", "/api/auth/signup", { body: { email: `me+${RUN}@test.dev`, password: "wrong-password" } })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { body: { email: `me+${RUN}@test.dev`, password: PW } })).user.id, U.me);
    const early = await call("POST", "/api/places/near", { token: T.me, body: { stay: "Eko Hotel" } });
    assert.equal(early.status, 409);
    const org = await call("POST", "/api/auth/signup", { body: { email: `org+${RUN}@test.dev`, password: PW, firstName: "Promoter", organiser: true } });
    T.org = org.token;
    U.org = org.user.id;
  });

  await t.test("taste: names become Qloo entities; unknown names come back to fix", async () => {
    for (const [k, p] of Object.entries(people)) {
      const items = p.taste.map(([type, name]) => ({ type, name }));
      if (k === "me") items.push({ type: "artist", name: "Zzqxv Notarealartist" });
      const r = await call("POST", "/api/me/taste", { token: T[k], body: { items } });
      assert.equal(r.status, 200, r.error);
      assert.equal(r.user.favourites.length, p.taste.length, `${k} favourites`);
      if (k === "me") assert.deepEqual(r.missing, ["Zzqxv Notarealartist"]);
      if (p.visibility) assert.equal((await call("POST", "/api/me/visibility", { token: T[k], body: { visibility: p.visibility } })).user.visibility, p.visibility);
    }
    assert.equal((await call("POST", "/api/me/visibility", { token: T.me, body: { visibility: "sometimes" } })).status, 400);
  });

  await t.test("places near the hotel: real, nights out only, with hours, travel and why", async () => {
    const r = await call("POST", "/api/places/near", { token: T.me, body: { stay: "Eko Hotel Victoria Island" } });
    assert.equal(r.status, 200, r.error);
    assert.match(r.origin.label, /Eko Hotel/);
    assert.ok(r.places.length >= 5, `only ${r.places.length}`);
    for (const p of r.places) {
      assert.ok(p.trip && p.trip.minutes > 0, `${p.name} trip`);
      assert.ok("known" in p.hours, `${p.name} hours`);
      assert.doesNotMatch(p.name, /church|school|university|hospital/i);
      assert.match(p.why, /^Fits your taste for /);
    }
    const area = await call("POST", "/api/places/near", { token: T.me, body: { stay: "Lekki Phase 1", kinds: ["lounge"] } });
    assert.equal(area.status, 200, area.error);
    assert.ok(area.places.length >= 1 && area.places.every((p) => p.kind === "lounge"));
    assert.equal((await call("POST", "/api/places/near", { token: T.me, body: { stay: "Eko Hotel", kinds: ["spa"] } })).status, 400);
    assert.equal((await call("POST", "/api/places/near", { token: T.me, body: {} })).status, 400);
  });

  await t.test("translate my city, and tonight from the venue I'm at", async () => {
    const tr = await call("POST", "/api/places/translate", { token: T.me, body: { city: "Lagos", stay: "Eko Hotel" } });
    assert.equal(tr.status, 200, tr.error);
    assert.ok(tr.places.length >= 3);
    const s = await call("GET", "/api/search?q=Quilox&type=place");
    const quilox = s.results.find((x) => /Victoria Island|Lagos/.test(x.detail || ""));
    assert.ok(quilox, "Quilox in Lagos found");
    U.quilox = quilox.id;
    const tn = await call("GET", `/api/places/tonight?venueId=${quilox.id}&kinds=restaurant,lounge`, { token: T.me });
    assert.equal(tn.status, 200, tn.error);
    assert.equal(tn.venue.name, "Quilox");
    QUILOX_AT = { lat: tn.venue.location.lat, lon: tn.venue.location.lon };
    assert.ok(tn.places.every((p) => p.id !== quilox.id));
    assert.ok(tn.places.every((p) => p.hours.open || p.hours.opensIn <= 30), "only places open now or about to open");
  });

  await t.test("events ranked by lineup; after-the-show places open late", async () => {
    const r = await call("GET", "/api/events", { token: T.me });
    assert.equal(r.status, 200, r.error);
    assert.ok(r.events[0].fit >= 90, `top fit ${r.events[0].fit}`);
    assert.ok(r.events.every((e) => e.status === "announced" || /describe/.test(e.note)), "examples say they're examples");
    const metal = await call("GET", "/api/events", { token: T.bob });
    const wiz = (list) => list.find((e) => e.id === "ddf-2026-opening").fit;
    assert.ok(wiz(r.events) - wiz(metal.events) >= 15, "Wizkid fits the Afrobeats fan far better than the metal fan");
    const a = await call("GET", "/api/events/ddf-2026-opening/after", { token: T.me });
    assert.equal(a.status, 200, a.error);
    assert.ok(a.places.length >= 1, "something is open after the show");
    assert.ok(a.places.every((p) => p.hours.open));
  });

  await t.test("who's here follows everyone's visibility choice", async () => {
    for (const k of Object.keys(people)) {
      const r = await call("POST", "/api/checkin", { token: T[k], body: { venueId: U.quilox, ...QUILOX_AT } });
      assert.equal(r.status, 200, r.error);
      assert.equal(r.checkin.verified, true, `${k} checked in at the venue's location`);
    }
    const here = await call("GET", "/api/here", { token: T.me });
    assert.equal(here.status, 200, here.error);
    const names = here.people.map((p) => p.firstName);
    assert.ok(names.includes("Julie"), "Julie (everyone) is visible");
    assert.ok(!names.includes("Bob"), "Bob (strong matches only) is hidden from a weak match");
    assert.ok(!names.includes("Kemi"), "Kemi (verified only) is hidden from an unverified viewer");
    assert.ok(!names.includes("Dayo"), "Dayo (groups only) never appears one to one");
    assert.ok(!names.includes("Zee"), "Zee (nobody) is invisible");
    assert.ok(here.groupMinded >= 1, "Dayo is counted for group plans");
    const julie = here.people.find((p) => p.firstName === "Julie");
    assert.ok(julie.match >= 50, `Julie match ${julie.match}`);
    assert.equal(julie.email, undefined);
    const zee = await call("GET", "/api/here", { token: T.zee });
    assert.equal(zee.people.length, 0);
  });

  await t.test("hi, accept, then chat; nothing opens early", async () => {
    assert.equal((await call("POST", "/api/hello", { token: T.me, body: { to: U.bob } })).status, 404);
    const hi = await call("POST", "/api/hello", { token: T.me, body: { to: U.julie } });
    assert.equal(hi.status, 200, hi.error);
    U.hello = hi.hello.id;
    assert.equal((await call("POST", "/api/hello", { token: T.me, body: { to: U.julie } })).hello.id, U.hello, "no duplicate hellos");
    const inbox = await call("GET", "/api/hello/inbox", { token: T.julie });
    assert.equal(inbox.hellos[0].firstName, "Ife");
    assert.equal(JSON.stringify(inbox).includes("@test.dev"), false, "no email leaks");
    assert.equal((await call("POST", `/api/hello/${U.hello}/messages`, { token: T.me, body: { text: "hey" } })).status, 403);
    assert.equal((await call("POST", `/api/hello/${U.hello}/answer`, { token: T.me, body: { accept: true } })).status, 404, "only Julie can answer");
    assert.equal((await call("POST", `/api/hello/${U.hello}/answer`, { token: T.julie, body: { accept: true } })).hello.status, "accepted");
    assert.equal((await call("POST", `/api/hello/${U.hello}/messages`, { token: T.me, body: { text: "Hi Julie! At the bar?" } })).status, 200);
    assert.equal((await call("POST", `/api/hello/${U.hello}/messages`, { token: T.julie, body: { text: "Yes, by the DJ" } })).status, 200);
    const msgs = await call("GET", `/api/hello/${U.hello}/messages`, { token: T.me });
    assert.deepEqual(msgs.messages.map((m) => m.mine), [true, false]);
    assert.equal((await call("GET", `/api/hello/${U.hello}/messages`, { token: T.bob })).status, 404);
  });

  await t.test("meet-up: both must agree; it ends on arrival, on leaving, or on stop", async () => {
    const q = { lat: 6.438, lon: 3.4381 };
    const m1 = await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.me });
    assert.equal(m1.meetup.status, "waiting");
    assert.equal((await call("POST", `/api/meetup/${m1.meetup.meetupId}/position`, { token: T.me, body: q })).status, 409, "no sharing until both agree");
    const m2 = await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.julie });
    assert.equal(m2.meetup.status, "live");
    assert.equal(m2.meetup.minutesLeft, 30);
    await call("POST", `/api/meetup/${m1.meetup.meetupId}/position`, { token: T.me, body: q });
    const j = await call("POST", `/api/meetup/${m1.meetup.meetupId}/position`, { token: T.julie, body: { lat: 6.4405, lon: 3.4381 } });
    assert.ok(j.meetup.metersApart > 200 && j.meetup.metersApart < 350, `apart ${j.meetup.metersApart}`);
    assert.ok((await call("GET", `/api/meetup/${m1.meetup.meetupId}`, { token: T.me })).meetup.them, "I can see Julie while it's live");
    assert.equal((await call("GET", `/api/meetup/${m1.meetup.meetupId}`, { token: T.bob })).status, 404, "nobody else can");
    const met = await call("POST", `/api/meetup/${m1.meetup.meetupId}/position`, { token: T.julie, body: { lat: 6.43805, lon: 3.43812 } });
    assert.equal(met.meetup.status, "ended");
    assert.equal(met.meetup.endedReason, "met");
    assert.equal(met.meetup.them, null, "positions cleared once ended");

    const m3 = (await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.me })).meetup;
    await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.julie });
    const far = await call("POST", `/api/meetup/${m3.meetupId}/position`, { token: T.julie, body: { lat: 6.46, lon: 3.4381 } });
    assert.equal(far.status, 410, "more than 1 km from the venue ends it");

    const m4 = (await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.me })).meetup;
    await call("POST", `/api/hello/${U.hello}/meetup`, { token: T.julie });
    assert.equal((await call("POST", `/api/meetup/${m4.meetupId}/stop`, { token: T.julie })).ended, true);
    assert.equal((await call("POST", `/api/meetup/${m4.meetupId}/position`, { token: T.me, body: q })).status, 410);
  });

  await t.test("block and report end everything between two people", async () => {
    assert.equal((await call("POST", "/api/block", { token: T.julie, body: { userId: U.me } })).blocked, true);
    const here = await call("GET", "/api/here", { token: T.me });
    assert.ok(!here.people.some((p) => p.firstName === "Julie"), "blocked people disappear for both");
    assert.equal((await call("POST", `/api/hello/${U.hello}/messages`, { token: T.me, body: { text: "?" } })).status, 403);
    assert.equal((await call("POST", "/api/report", { token: T.me, body: { userId: U.bob, reason: "test" } })).blocked, true);
  });

  await t.test("share my night, check out", async () => {
    const s = await call("GET", "/api/share-night", { token: T.me });
    assert.match(s.text, /Quilox/);
    assert.equal((await call("DELETE", "/api/checkin", { token: T.me })).checkedOut, true);
    assert.equal((await call("GET", "/api/here", { token: T.me })).status, 409);
  });

  await t.test("organiser: totals only, own events, and visitors see them", async () => {
    assert.equal((await call("GET", "/api/organiser/dashboard", { token: T.me })).status, 403);
    const d = await call("GET", "/api/organiser/dashboard", { token: T.org });
    assert.equal(d.status, 200, d.error);
    assert.ok(d.visitors >= 3);
    assert.equal(JSON.stringify(d).includes("@test.dev"), false, "no emails");
    assert.ok(d.homeCities.rows.every((r) => r.people >= 3), "small groups folded away");
    assert.deepEqual(d.homeCities.rows.map((r) => r.name), ["Houston"], "Houston has 3 visitors; London and Atlanta are too small to show");
    assert.ok(d.homeCities.other >= 3, "the small groups are counted as other");
    assert.ok(d.topSounds.rows.length >= 1, "top sounds shown");
    assert.equal((await call("POST", "/api/organiser/events", { token: T.org, body: { title: "x" } })).status, 400);
    const ev = await call("POST", "/api/organiser/events", { token: T.org, body: { title: "Rooftop R&B Sundays", starts: "2026-12-20T20:00:00+01:00", ends: "2026-12-21T01:00:00+01:00", venue: { name: "Rooftop", lat: 6.43, lon: 3.42 }, lineup: ["Tems", "Ayra Starr"] } });
    assert.equal(ev.status, 200, ev.error);
    const mine = await call("GET", "/api/events", { token: T.julie });
    assert.ok(mine.events.some((e) => e.title === "Rooftop R&B Sundays"));
  });
});
