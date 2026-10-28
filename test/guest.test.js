// Guests and the demo venue: in with no typing, no new Qloo calls per guest,
// view-only venue, guests reach demo people only, upgrade keeps the account,
// and the clean-up deletes only old guests, by exact id. Offline.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startQlooStub } from "./helpers/qloo-stub.js";

const VENUE = { entity_id: "jazz", name: "Jazz Cafe", location: { lat: 51.5390, lon: -0.1426 }, properties: {}, tags: [] };
const stub = await startQlooStub((path, p) => {
  if (path === "/search") {
    const place = p.types === "urn:entity:place";
    return { results: [{ entity_id: `E-${p.query}`, name: p.query, location: place ? { lat: 51.5255, lon: -0.0776 } : undefined, properties: { address: "London" } }] };
  }
  if (path === "/entities") return { results: p.entity_ids === "jazz" ? [VENUE] : [] };
  if (path === "/v2/insights" && p["filter.type"] === "urn:tag") return { results: { tags: p["filter.tag.types"] === "urn:tag:genre:music" ? [{ name: "afrobeats" }, { name: "jazz" }] : [] } };
  return { results: { tags: [], entities: [] } };
});

const dir = mkdtempSync(join(tmpdir(), "outside-guest-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";
process.env.SESSION_SECRET = "g".repeat(40);
process.env.CRON_SECRET = "cron-guest-secret";

const store = await import("../src/store.js");
const guest = await import("../src/guest.js");
const people = await import("../src/people.js");
const { profileFor } = await import("../src/likeness.js");
const { crowdAt } = await import("../src/crowd.js");
const { handle, READ_ONLY } = await import("../src/router.js");

const server = createServer((req, res) => handle(req, res));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(async () => { server.close(); await stub.close(); rmSync(dir, { recursive: true, force: true }); });

async function api(method, path, { token, body, ip = "10.0.0.1" } = {}) {
  const headers = { "x-real-ip": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json()) };
}

beforeEach(() => guest.forgetHits());

const future = () => new Date(Date.now() + 3 * 3600_000).toISOString();
const checkin = (userId, extra = {}) => store.put("checkins", { userId, venueId: "jazz", venueName: "Jazz Cafe", venueLocation: VENUE.location, city: "London", verified: true, at: new Date().toISOString(), expiresAt: future(), ...extra });

test("a guest in London with the template taste; the second guest costs no Qloo calls and shares one profile", async () => {
  const a = await api("POST", "/api/demo/guest");
  assert.equal(a.status, 200, a.error);
  assert.ok(a.token);
  assert.match(a.user.id, /^guest-/);
  assert.equal(a.user.firstName, "Guest");
  assert.equal(a.user.guest, true);
  assert.equal(a.user.demo, true);
  assert.equal(a.user.city, "London");
  assert.equal(a.user.visibility, "everyone");
  assert.ok(Number.isFinite(a.user.stay.lat));
  assert.deepEqual(a.user.favourites.map((f) => f.name), ["Burna Boy", "Tems", "Ezra Collective", "Dishoom Shoreditch"]);
  assert.ok(a.user.avatar.skin);
  assert.ok(await store.get("templates", "guest-london"), "template kept in the store");

  const me = await api("GET", "/api/me", { token: a.token });
  assert.equal(me.user.guest, true);
  assert.equal(me.user.readOnly, false);

  const before = stub.calls.length;
  guest.forgetTemplate(); // even from a cold start, the store holds the template
  const b = await api("POST", "/api/demo/guest");
  assert.equal(b.status, 200);
  assert.equal(stub.calls.length, before, "no Qloo calls for a new guest");
  assert.notEqual(a.user.id, b.user.id);

  const [ua, ub] = await Promise.all([store.get("users", a.user.id), store.get("users", b.user.id)]);
  const pa = await profileFor(ua);
  const n = stub.calls.length;
  const pb = await profileFor(ub);
  assert.equal(pa.id, pb.id, "guests share one stored profile");
  assert.equal(stub.calls.length, n);
});

test("guests are rate-limited per IP", async () => {
  for (let i = 0; i < guest.GUESTS_PER_HOUR; i++) assert.equal((await api("POST", "/api/demo/guest", { ip: "10.9.9.9" })).status, 200);
  const no = await api("POST", "/api/demo/guest", { ip: "10.9.9.9" });
  assert.equal(no.status, 429);
  assert.equal((await api("POST", "/api/demo/guest", { ip: "10.9.9.8" })).status, 200);
  assert.equal(guest.clientIp({ headers: { "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" } }), "1.2.3.4");
});

test("the demo venue is view-only; guests can't run a venue", async () => {
  assert.equal((await api("POST", "/api/demo/venue")).status, 503);
  await store.put("users", { id: "demo-venue", email: "venue@demo.outside.invalid", firstName: "Demo · Jazz Cafe", role: "organiser", demo: true, favourites: [], visibility: "nobody", venueId: "jazz", venueName: "Jazz Cafe", venueCity: "London", city: "London" });
  const v = await api("POST", "/api/demo/venue");
  assert.equal(v.status, 200, v.error);
  assert.equal(v.user.readOnly, true);
  assert.equal(v.user.role, "organiser");
  assert.equal((await api("GET", "/api/me", { token: v.token })).user.readOnly, true);

  const pick = await api("POST", "/api/organiser/venue", { token: v.token, body: { venueId: "jazz" } });
  assert.equal(pick.status, 403);
  assert.equal(pick.error, READ_ONLY);
  const ev = await api("POST", "/api/organiser/events", { token: v.token, body: { title: "X", lineup: ["Y"], starts: future(), venue: { lat: 51.5, lon: -0.1 } } });
  assert.equal(ev.status, 403);
  assert.equal(ev.error, READ_ONLY);
  assert.equal((await api("POST", "/api/checkin", { token: v.token, body: { venueId: "jazz" } })).status, 403);
  const dash = await api("GET", "/api/organiser/dashboard", { token: v.token });
  assert.notEqual(dash.error, READ_ONLY);
  assert.equal((await store.get("users", "demo-venue")).readOnly, undefined, "the flag lives in the token, not the record");

  // The flag is signed: dropping it breaks the token.
  const [body] = v.token.split(".");
  const plain = JSON.parse(Buffer.from(body, "base64url").toString());
  delete plain.ro;
  const forged = `${Buffer.from(JSON.stringify(plain)).toString("base64url")}.${v.token.split(".")[1]}`;
  assert.equal((await api("GET", "/api/me", { token: forged })).status, 401);

  // A read-only session signing up makes a new account, never touches the demo venue.
  const s = await api("POST", "/api/auth/signup", { token: v.token, body: { email: "new-venue@test.dev", password: "long-enough-pw", firstName: "Ola", organiser: true } });
  assert.equal(s.status, 200, s.error);
  assert.notEqual(s.user.id, "demo-venue");
  assert.equal((await store.get("users", "demo-venue")).email, "venue@demo.outside.invalid");

  const g = await api("POST", "/api/demo/guest");
  assert.equal((await api("POST", "/api/organiser/venue", { token: g.token, body: { venueId: "jazz" } })).status, 403);
  assert.equal((await api("POST", "/api/organiser/events", { token: g.token, body: {} })).status, 403);
});

test("guests say hi to demo people only, and count as demo in the crowd", async () => {
  const g = await api("POST", "/api/demo/guest");
  const me = await store.get("users", g.user.id);
  const fav = me.favourites;
  const demoU = await store.put("users", { id: "demo-amara", firstName: "Demo · Amara", demo: true, favourites: fav, visibility: "everyone", city: "London" });
  const real = await store.put("users", { id: "real-hi", firstName: "Real", favourites: fav, visibility: "everyone", city: "London" });
  const other = await api("POST", "/api/demo/guest");
  for (const id of [me.id, demoU.id, real.id, other.user.id]) await checkin(id);

  const toReal = await api("POST", "/api/hello", { token: g.token, body: { to: real.id } });
  assert.equal(toReal.status, 403);
  assert.equal(toReal.error, people.GUEST_HI);
  assert.equal((await api("POST", "/api/hello", { token: g.token, body: { to: other.user.id } })).status, 403, "not other guests either");
  const toDemo = await api("POST", "/api/hello", { token: g.token, body: { to: demoU.id } });
  assert.equal(toDemo.status, 200, toDemo.error);

  // A real person sees the guest as demo, with the Demo tag on the face.
  const crowd = (await crowdAt(real, ["jazz"], { faces: true, cityName: "London" })).get("jazz");
  assert.equal(crowd.here, 3);
  assert.equal(crowd.demo, 3, "demo person and both guests");
  assert.ok(crowd.faces.every((f) => f.demo === true));
  const here = await people.whoIsHere(real);
  assert.equal(here.people.find((p) => p.userId === me.id).demo, true);
});

test("a guest signing up keeps their account and stops being a guest", async () => {
  const g = await api("POST", "/api/demo/guest");
  const before = await store.get("users", g.user.id);
  await store.put("reviews", { id: `r-${g.user.id}`, userId: g.user.id, placeId: "jazz", stars: 5, demo: true });
  const s = await api("POST", "/api/auth/signup", { token: g.token, body: { email: "Ife@Test.dev", password: "long-enough-pw", firstName: "Ife" } });
  assert.equal(s.status, 200, s.error);
  assert.equal(s.upgraded, true);
  assert.equal(s.user.id, g.user.id);
  assert.equal(s.user.firstName, "Ife");
  assert.equal(s.user.email, "ife@test.dev");
  assert.equal(s.user.guest, false);
  assert.equal(s.user.demo, false);
  assert.deepEqual(s.user.favourites, before.favourites);
  assert.deepEqual(s.user.stay, before.stay);
  assert.deepEqual(s.user.avatar, before.avatar);
  assert.equal(s.user.city, "London");
  const saved = await store.get("users", g.user.id);
  assert.equal(saved.guest, undefined);
  assert.equal(saved.demo, undefined);
  assert.equal((await store.get("reviews", `r-${g.user.id}`)).demo, false);

  const login = await api("POST", "/api/auth/login", { body: { email: "ife@test.dev", password: "long-enough-pw" } });
  assert.equal(login.user.id, g.user.id);

  // Without a token, sign-up still makes a new account; an existing email still needs its password.
  const fresh = await api("POST", "/api/auth/signup", { body: { email: "other@test.dev", password: "long-enough-pw", firstName: "Bo" } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.upgraded, false);
  assert.equal(fresh.user.guest, false);
  const g2 = await api("POST", "/api/demo/guest");
  const taken = await api("POST", "/api/auth/signup", { token: g2.token, body: { email: "ife@test.dev", password: "wrong-password-x", firstName: "X" } });
  assert.equal(taken.status, 401);
  assert.equal((await store.get("users", g2.user.id)).guest, true);
});

test("clean-up deletes guests older than 48h and their records, by exact id, and nobody else", async () => {
  const old = new Date(Date.now() - 49 * 3600_000).toISOString();
  const oldG = (await api("POST", "/api/demo/guest")).user.id;
  const youngG = (await api("POST", "/api/demo/guest")).user.id;
  await store.put("users", { ...(await store.get("users", oldG)), createdAt: old });
  const real = await store.put("users", { id: "real-keep", firstName: "Keep", createdAt: old, favourites: [] });
  const demoP = await store.put("users", { id: "demo-keep", firstName: "Demo · Keep", demo: true, createdAt: old, favourites: [] });
  const fake = await store.put("users", { id: "guest-not-really", guest: true, createdAt: old, favourites: [] }); // not a guest id
  const upgraded = await store.put("users", { id: "guest-00000000-0000-4000-8000-000000000000", createdAt: old, favourites: [] }); // was a guest, signed up

  await checkin(oldG, { id: "c-old" });
  await checkin(real.id, { id: "c-real" });
  await store.put("reviews", { id: "r-old", userId: oldG, placeId: "jazz", stars: 4, demo: true });
  await store.put("reviews", { id: "r-real", userId: real.id, placeId: "jazz", stars: 4 });
  await store.put("hellos", { id: "h-old", from: oldG, to: demoP.id, status: "accepted" });
  await store.put("hellos", { id: "h-in", from: real.id, to: oldG, status: "pending" });
  await store.put("hellos", { id: "h-keep", from: real.id, to: demoP.id, status: "accepted" });
  await store.put("messages", { id: "m-old", helloId: "h-old", from: demoP.id, text: "hi" });
  await store.put("messages", { id: "m-keep", helloId: "h-keep", from: real.id, text: "hi" });
  await store.put("meetups", { id: "mu-old", helloId: "h-old", users: [oldG, demoP.id] });
  await store.put("meetups", { id: "mu-keep", helloId: "h-keep", users: [real.id, demoP.id] });
  await store.put("blocks", { id: "b-old", by: real.id, who: oldG });

  const res = await fetch(`${BASE}/api/cron/demo`, { headers: { authorization: "Bearer cron-guest-secret" } }).then((r) => r.json());
  assert.ok(res.guestsRemoved.users >= 1, JSON.stringify(res));

  assert.equal(await store.get("users", oldG), null);
  for (const [c, id] of [["checkins", "c-old"], ["reviews", "r-old"], ["hellos", "h-old"], ["hellos", "h-in"], ["messages", "m-old"], ["meetups", "mu-old"], ["blocks", "b-old"]]) assert.equal(await store.get(c, id), null, `${c}/${id}`);
  for (const [c, id] of [["users", youngG], ["users", real.id], ["users", demoP.id], ["users", fake.id], ["users", upgraded.id], ["checkins", "c-real"], ["reviews", "r-real"], ["hellos", "h-keep"], ["messages", "m-keep"], ["meetups", "mu-keep"]]) assert.ok(await store.get(c, id), `${c}/${id} kept`);

  await assert.rejects(guest.removeGuest(real.id), /non-guest/);
  await assert.rejects(guest.removeGuest(upgraded.id), /not a guest/);
  await assert.rejects(guest.removeGuest(""), /non-guest/);
  assert.ok(await store.get("users", upgraded.id));
});
