// Attack tests (the tester's file): privacy, auth/roles, input abuse and logic
// edges, over real HTTP against an in-process server. Offline: Qloo is a stub,
// the store is a temp file, Claude points at a dead port and is never needed.
// A failing test here is a bug the coders must fix, not a flaky test.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startQlooStub } from "./helpers/qloo-stub.js";

/* ---------- fake Qloo ---------- */
// Each person loves one thing, "fav-pN"; their music set is t0..t(N-1) and the
// viewer's is t0..t99, so a person's match with the viewer is exactly N.
const tagsFor = (fav) => {
  const n = fav === "fav-viewer" ? 100 : Number(String(fav).replace("fav-p", ""));
  return Array.from({ length: Number.isFinite(n) ? n : 0 }, (_, i) => ({ name: `t${i}` }));
};
const PLACES = {
  ronnie: { entity_id: "ronnie", name: "Ronnie Scott's", location: { lat: 51.5134, lon: -0.1317 }, properties: {}, tags: [] },
  "lagos-club": { entity_id: "lagos-club", name: "Quilox", location: { lat: 6.4300, lon: 3.4200 }, properties: {}, tags: [] },
};
const stub = await startQlooStub((path, p) => {
  if (path === "/entities") return { results: PLACES[p.entity_ids] ? [PLACES[p.entity_ids]] : [] };
  if (path === "/search") return { results: [] };
  if (path !== "/v2/insights") return { results: {} };
  if (p["filter.type"] === "urn:tag" && p["filter.tag.types"] === "urn:tag:genre:music") return { results: { tags: tagsFor(p["signal.interests.entities"]) } };
  if (p["filter.type"] === "urn:entity:place" && p["filter.results.entities"]) {
    const e = PLACES[p["filter.results.entities"]];
    return { results: { entities: e ? [e] : [] } };
  }
  return { results: { tags: [], entities: [] } };
});

const dir = mkdtempSync(join(tmpdir(), "outside-attack-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";
process.env.SESSION_SECRET = "s".repeat(40);
process.env.ADMIN_TOKEN = "admin-test-token-xyz";
process.env.CRON_SECRET = "cron-test-secret-xyz";
process.env.ANTHROPIC_API_KEY = "test";
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";

const store = await import("../src/store.js");
const people = await import("../src/people.js");
const { handle } = await import("../src/router.js");
const { issueToken } = await import("../src/auth.js");
const { crowdAt } = await import("../src/crowd.js");
const { summarize, addReview } = await import("../src/reviews.js");
const ce = await import("../src/city-events.js");
const { nextLocalHour } = await import("../src/geo.js");
const { timeWindow } = await import("../src/map.js");
const { rideLinks } = await import("../src/rides.js");

const server = createServer((req, res) => handle(req, res));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(async () => { server.close(); await stub.close(); rmSync(dir, { recursive: true, force: true }); });

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const RONNIE = PLACES.ronnie.location;
const H = 3600_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

/** Keep every city we touch "searched today", so nothing ever calls Claude. */
async function markAllFresh() {
  const { CITIES } = await import("../src/cities.js");
  for (const c of CITIES) await store.put("searches", { id: c.slug, city: c.name, status: "done", lastSearchAt: new Date().toISOString(), startedAt: new Date().toISOString() });
}
beforeEach(async () => { await store.reset(); await markAllFresh(); });

const viewerOf = (o = {}) => store.put("users", { firstName: "Viewer", email: "viewer@x.dev", city: "London", favourites: [{ id: "fav-viewer", name: "Mine" }], visibility: "everyone", verified: false, ...o });
async function person(n, { visibility = "everyone", venueId = "ronnie", demo = false, verified = false } = {}) {
  const u = await store.put("users", { firstName: `Secretname${n}`, email: `p${n}@secret.dev`, city: "London", favourites: [{ id: `fav-p${n}`, name: `Thing ${n}` }], visibility, verified, avatar: { skin: `#${n}` }, ...(demo ? { demo: true } : {}) });
  await store.put("checkins", { userId: u.id, city: "London", venueId, venueName: "Ronnie Scott's", venueLocation: RONNIE, at: iso(-10 * 60_000), expiresAt: iso(3 * H) });
  return u;
}
const tok = (u) => issueToken(u.id);

/* ======================= 1. PRIVACY ======================= */

test("privacy: map and place card never carry another person's name, id or email; nobody/blocked aren't counted; faces follow visibility", async () => {
  const viewer = await viewerOf();
  const shown = [await person(70), await person(65, { visibility: "strong" }), await person(50, { visibility: "verified" })];
  const hidden = [await person(80, { visibility: "nobody" }), await person(90), await person(85)];
  await store.put("blocks", { by: viewer.id, who: hidden[1].id, at: iso(0) });
  await store.put("blocks", { by: hidden[2].id, who: viewer.id, at: iso(0) });
  await store.put("reviews", { id: "r1", userId: shown[0].id, placeId: "ronnie", placeName: "Ronnie Scott's", city: "London", stars: 5, note: "Great horns", day: "2026-10-26", at: iso(-H) });

  const map = await api("GET", "/api/map?when=tonight", { token: tok(viewer) });
  assert.equal(map.status, 200, map.text);
  const card = await api("GET", "/api/places/ronnie", { token: tok(viewer) });
  assert.equal(card.status, 200, card.text);
  for (const u of [...shown, ...hidden]) {
    for (const leak of [u.id, u.firstName, u.email]) {
      assert.ok(!map.text.includes(leak), `map leaks ${leak}`);
      assert.ok(!card.text.includes(leak), `place card leaks ${leak}`);
    }
  }
  const r = map.json.venues.find((v) => v.id === "ronnie");
  assert.equal(r.crowd.here, 3, "nobody and both blocked directions are not counted");
  assert.equal(card.json.crowd.here, 3);
  assert.equal(card.json.crowd.faces.length, 2, "unverified viewer sees everyone + strong(65), not verified-only");
  assert.equal(card.json.ours.notes[0].note, "Great horns");

  const invisible = await viewerOf({ email: "inv@x.dev", visibility: "nobody" });
  const c2 = await api("GET", "/api/places/ronnie", { token: tok(invisible) });
  assert.equal(c2.json.crowd.here, 5, "the blocks were with the first viewer, not this one");
  assert.deepEqual(c2.json.crowd.faces, [], "an invisible viewer sees counts only");
});

test("privacy: demo people are labelled as demo where they show up (card faces, crowd counts, review notes)", async () => {
  const viewer = await viewerOf();
  const d = await person(70, { demo: true });
  await store.put("reviews", { id: "rd", userId: d.id, placeId: "ronnie", city: "London", stars: 5, note: "Demo note", day: "2026-10-26", at: iso(-H), demo: true });
  const card = await api("GET", "/api/places/ronnie", { token: tok(viewer) });
  assert.equal(card.status, 200, card.text);
  const face = card.json.crowd.faces[0];
  assert.ok(face?.demo === true || card.json.crowd.demo >= 1, "a demo face/count must say it's a demo person");
  assert.equal(card.json.ours.notes[0]?.demo, true, "a demo review note must say it's from a demo person");
});

test("privacy: checking in without being there doesn't unlock names (no location, or too far, is unverified)", async () => {
  // Lead decision: a remote check-in is still allowed (it counts in crowds) but is unverified,
  // and only a verified check-in (location within 300 m of the venue) shows names or lets you say hi.
  const stalker = await viewerOf({ email: "stalker@x.dev" });
  const target = await person(70);
  for (const body of [{ venueId: "ronnie" }, { venueId: "ronnie", lat: 51.53, lon: -0.10 }]) {
    const r = await api("POST", "/api/checkin", { token: tok(stalker), body });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.checkin.verified, false, `verified with ${JSON.stringify(body)}`);
    const here = await api("GET", "/api/here", { token: tok(stalker) });
    assert.equal(here.status, 200, here.text);
    assert.deepEqual(here.json.people, [], "an unverified check-in sees names");
    assert.equal(here.json.here, 1);
    assert.ok(!here.text.includes(target.firstName) && !here.text.includes(target.id), "/api/here leaks a name or id");
    assert.match(here.json.note, /Share your location/);
    assert.equal((await api("POST", "/api/hello", { token: tok(stalker), body: { to: target.id } })).status, 403);
  }
  // Still counted in the crowd for others.
  const other = await viewerOf({ email: "other@x.dev", favourites: [{ id: "fav-p70", name: "x" }] });
  assert.equal((await api("GET", "/api/places/ronnie", { token: tok(other) })).json.crowd.here, 2);

  const near = await api("POST", "/api/checkin", { token: tok(stalker), body: { venueId: "ronnie", lat: RONNIE.lat + 0.001, lon: RONNIE.lon } }); // ~110 m
  assert.equal(near.json.checkin.verified, true);
  const here = await api("GET", "/api/here", { token: tok(stalker) });
  assert.deepEqual(here.json.people.map((p) => p.firstName), [target.firstName]);
  assert.equal((await api("POST", "/api/hello", { token: tok(stalker), body: { to: target.id } })).status, 200);
  assert.equal((await api("POST", "/api/checkin", { token: tok(stalker), body: { venueId: "ronnie", lat: 999, lon: 0 } })).status, 400);
});

test("auth: signing up with someone else's email doesn't hand over their account", async () => {
  const victim = await viewerOf({ email: "victim@x.dev" });
  const r = await api("POST", "/api/auth/signup", { body: { email: "victim@x.dev", firstName: "Mallory" } });
  assert.ok(!(r.status === 200 && r.json?.user?.id === victim.id), `got a session for the victim's account (id ${r.json?.user?.id})`);
});

test("auth: signup with organiser:true can't turn an existing account into an organiser", async () => {
  await viewerOf({ email: "victim2@x.dev" });
  await api("POST", "/api/auth/signup", { body: { email: "victim2@x.dev", organiser: true } });
  const after = (await store.list("users", (u) => u.email === "victim2@x.dev"))[0];
  assert.equal(after.role ?? null, null, "the existing account was made an organiser");
});

test("roles: an organiser can't claim a venue another organiser already holds", async () => {
  await store.put("users", { id: "org-a", email: "a@v.dev", firstName: "A", role: "organiser", city: "London", favourites: [], venueId: "ronnie", venueName: "Ronnie Scott's" });
  const b = await store.put("users", { email: "b@v.dev", firstName: "B", role: "organiser", city: "London", favourites: [] });
  const r = await api("POST", "/api/organiser/venue", { token: tok(b), body: { venueId: "ronnie" } });
  assert.notEqual(r.status, 200, "a second organiser took over Ronnie Scott's dashboard with no proof of owning it");
});

test("privacy: the venue dashboard 'days' can't be shrunk to minutes to watch who just walked in", async () => {
  const org = await store.put("users", { email: "org@v.dev", firstName: "O", role: "organiser", city: "London", favourites: [], venueId: "ronnie", venueName: "Ronnie Scott's", venueCity: "London" });
  await person(70); await person(71); await person(72);
  const r = await api("GET", "/api/organiser/dashboard?days=0.01", { token: tok(org) });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.venue.days >= 1, `days accepted as ${r.json.venue.days} (≈${Math.round(r.json.venue.days * 1440)} minutes)`);
});

/* ======================= 2. AUTH / ROLES ======================= */

test("roles: organiser-only routes refuse plain users", async () => {
  const u = await viewerOf();
  for (const [m, p, body] of [["POST", "/api/organiser/venue", { venueId: "ronnie" }], ["GET", "/api/organiser/dashboard"], ["POST", "/api/organiser/events", { title: "x", lineup: ["a"], starts: iso(H), venue: { lat: 51.5, lon: -0.1 } }]]) {
    const r = await api(m, p, { token: tok(u), body });
    assert.equal(r.status, 403, `${m} ${p} → ${r.status}`);
  }
});

test("auth: admin and cron routes refuse missing, wrong and swapped tokens", async () => {
  const cases = [
    ["POST", "/api/admin/refresh-events", undefined],
    ["POST", "/api/admin/refresh-events", "nope"],
    ["POST", "/api/admin/refresh-events", "cron-test-secret-xyz"],
    ["GET", "/api/cron/events", undefined],
    ["GET", "/api/cron/events", "admin-test-token-xyz"],
    ["GET", "/api/cron/demo", ""],
    ["GET", "/api/cron/demo", "wrong"],
  ];
  for (const [m, p, t] of cases) {
    const res = await fetch(BASE + p, { method: m, headers: t === undefined ? {} : { authorization: `Bearer ${t}` } });
    assert.equal(res.status, 403, `${m} ${p} with ${JSON.stringify(t)} → ${res.status}`);
  }
  // Right token, bad city: refused before any search runs.
  const r = await api("POST", "/api/admin/refresh-events", { token: "admin-test-token-xyz", body: { city: "Atlantis" } });
  assert.equal(r.status, 400);
});

test("auth: no favourites → map and events are 409; deleted user and forged tokens → 401", async () => {
  const bare = await viewerOf({ email: "bare@x.dev", favourites: [] });
  for (const p of ["/api/map", "/api/events", "/api/events/x", "/api/events/x/after"]) {
    assert.equal((await api("GET", p, { token: tok(bare) })).status, 409, p);
  }
  const gone = await viewerOf({ email: "gone@x.dev" });
  const t = tok(gone);
  await store.remove("users", gone.id);
  assert.equal((await api("GET", "/api/map", { token: t })).status, 401);
  const [body, mac] = tok(bare).split(".");
  const forged = Buffer.from(JSON.stringify({ u: gone.id, exp: Date.now() + H })).toString("base64url");
  assert.equal((await api("GET", "/api/me", { token: `${forged}.${mac}` })).status, 401);
  assert.equal((await api("GET", "/api/me", { token: `${body}.` })).status, 401);
  assert.equal((await api("GET", "/api/me", { token: "a.b.c" })).status, 401);
});

/* ======================= 3. INPUT ABUSE ======================= */

async function checkedIn(u, ago = H, venueId = "ronnie", loc = RONNIE, city = "London") {
  return store.put("checkins", { userId: u.id, city, venueId, venueName: "V", venueLocation: loc, at: iso(-ago), expiresAt: iso(3 * H) });
}

test("reviews: bad stars are 400 (0, 6, 2.5, -1, 1e3, 'abc', null)", async () => {
  const u = await viewerOf(); await checkedIn(u);
  for (const stars of [0, 6, 2.5, -1, 1000, "abc", null]) {
    const r = await api("POST", "/api/reviews", { token: tok(u), body: { placeId: "ronnie", stars, note: "ok" } });
    assert.equal(r.status, 400, `stars ${JSON.stringify(stars)} → ${r.status}`);
  }
});

test("reviews: non-number stars (true, [5]) are refused, not read as 1 and 5", async () => {
  const u = await viewerOf(); await checkedIn(u);
  for (const stars of [true, [5]]) {
    const r = await api("POST", "/api/reviews", { token: tok(u), body: { placeId: "ronnie", stars, note: "" } });
    assert.equal(r.status, 400, `stars ${JSON.stringify(stars)} accepted as ${r.json?.review?.stars}`);
    if (r.status === 200) await store.remove("reviews", r.json.review.id);
  }
});

test("reviews: notes: 141 chars and links are 400, 140 is fine, control characters are stripped", async () => {
  const u = await viewerOf(); await checkedIn(u);
  const post = (note) => api("POST", "/api/reviews", { token: tok(u), body: { placeId: "ronnie", stars: 4, note } });
  assert.equal((await post("a".repeat(141))).status, 400);
  for (const n of ["see https://x.dev", "www.spam.example", "bit.ly/abc", "HTTP://X.COM"]) assert.equal((await post(n)).status, 400, n);
  const ok = await post(`a\u0000b\u0007c\u001b[31m${"d".repeat(120)}`);
  assert.equal(ok.status, 200, ok.text);
  assert.ok(!/[\u0000-\u001f]/.test(ok.json.review.note));
});

test("reviews: notes refuse bidi overrides, non-string notes and links on other TLDs", async () => {
  const u = await viewerOf(); await checkedIn(u);
  const post = async (note) => { const r = await api("POST", "/api/reviews", { token: tok(u), body: { placeId: "ronnie", stars: 4, note } }); if (r.status === 200) await store.remove("reviews", r.json.review.id); return r; };
  const bidi = await post("great ‮gnp.exe‬ night");
  assert.ok(bidi.status === 400 || !/[‪-‮⁦-⁩]/.test(bidi.json.review.note), "right-to-left override kept in a note");
  const obj = await post({ evil: true });
  assert.equal(obj.status, 400, `object note saved as ${JSON.stringify(obj.json?.review?.note)}`);
  const ru = await post("cheap tickets at scam-tix.ru now");
  assert.equal(ru.status, 400, "link on a TLD outside the short list got through");
});

test("reviews: 48h window, future check-ins, twice a day, and a place you never checked in at", async () => {
  const u = await viewerOf();
  const post = (placeId = "ronnie") => api("POST", "/api/reviews", { token: tok(u), body: { placeId, stars: 4, note: "" } });
  await checkedIn(u, 49 * H);
  assert.equal((await post()).status, 403, "49h ago");
  await checkedIn(u, -2 * H); // a check-in dated in the future
  assert.equal((await post()).status, 403, "future-dated check-in");
  await checkedIn(u, 47 * H);
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 409, "second review the same day");
  assert.equal((await post("lagos-club")).status, 403, "never checked in there");
  assert.equal((await post("../../etc/passwd")).status, 403);
});

test("reviews: one person rating on two days counts once in 'people like you'", () => {
  const s = summarize([
    { userId: "a", stars: 1, at: "2026-10-25T20:00:00Z" },
    { userId: "a", stars: 1, at: "2026-10-26T20:00:00Z" },
  ], { viewerId: "v", similarity: () => 80 });
  assert.equal(s.likeYou.count, 1, "the same reviewer counted twice");
  assert.equal(s.likeYou.enough, false, "one person made 'enough' true on their own");
});

test("check-in: a London user checking in at a Lagos venue is filed under Lagos, not shown on London's map", async () => {
  const u = await viewerOf({ email: "trav@x.dev" });
  const c = await people.checkIn(u, "lagos-club");
  assert.equal(c.city, "Lagos", `check-in filed under ${c.city}`);
  const londoner = await store.put("users", { firstName: "L", email: "l@x.dev", city: "London", favourites: [{ id: "fav-p70", name: "x" }], visibility: "everyone" });
  const m = await crowdAt(londoner, null, { cityName: "London" });
  assert.ok(!m.has("lagos-club"), "a Lagos venue appears in London's crowd");
});

test("city and stay: unknown city, object city, NaN and empty are 400; far stay is 422", async () => {
  const u = await viewerOf();
  for (const body of [{ city: "Atlantis" }, { city: { name: "London" } }, { lat: "abc", lon: "def" }, {}, { lat: 91, lon: 0 }]) {
    const r = await api("POST", "/api/me/city", { token: tok(u), body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${r.text}`);
  }
  assert.equal((await api("POST", "/api/me/stay", { token: tok(u), body: { stay: { lat: 48.85, lon: 2.35 } } })).status, 422);
  assert.equal((await api("POST", "/api/me/stay", { token: tok(u), body: {} })).status, 400);
  const long = await api("POST", "/api/me/stay", { token: tok(u), body: { stay: { lat: 51.51, lon: -0.12, label: "x".repeat(5000) } } });
  assert.equal(long.status, 200);
  assert.ok(long.json.stay.label.length <= 80);
});

test("stay: an out-of-range point (lat 411.5 = London + 360°) is refused", async () => {
  const u = await viewerOf();
  const r = await api("POST", "/api/me/stay", { token: tok(u), body: { stay: { lat: 411.5072, lon: -0.1276 } } });
  assert.notEqual(r.status, 200, `saved stay ${JSON.stringify(r.json?.stay)}`);
});

test("map: bad when, kinds and lat/lon are 400", async () => {
  const u = await viewerOf();
  for (const q of ["when=someday", "when=", "kinds=karaoke", "kinds=food,,%00", "lat=abc&lon=1", "lat=91&lon=0", "lat=0&lon=181", "lat=Infinity&lon=0"]) {
    const r = await api("GET", `/api/map?${q}`, { token: tok(u) });
    assert.ok(r.status === 400 || (q === "when=" && r.status === 200), `${q} → ${r.status} ${r.text.slice(0, 120)}`);
  }
  assert.equal((await api("GET", "/api/events?when=yesterday", { token: tok(u) })).status, 400);
});

test("map: a huge unknown 'kinds' isn't echoed back in full", async () => {
  const u = await viewerOf();
  const r = await api("GET", `/api/map?kinds=${"x".repeat(6000)}`, { token: tok(u) });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.length < 300, `error message is ${r.json.error.length} characters`);
});

test("ids: path traversal and huge ids answer JSON 4xx, never 500", async () => {
  const u = await viewerOf();
  for (const id of ["..%2F..%2Fentities", "%2E%2E", "a".repeat(4000), "x%20y"]) {
    const r = await api("GET", `/api/places/${id}`, { token: tok(u) });
    assert.ok(r.status >= 400 && r.status < 500 && r.json?.error, `${id.slice(0, 30)} → ${r.status}`);
  }
});

test("ids: a malformed %-escape in a path is 400, not 500", async () => {
  const u = await viewerOf();
  const r = await api("GET", "/api/places/%E0%A4%A", { token: tok(u) });
  assert.equal(r.status, 400, `→ ${r.status} ${r.text}`);
});

test("bodies: oversized is 413, broken JSON is 400", async () => {
  const u = await viewerOf();
  assert.equal((await api("POST", "/api/reviews", { token: tok(u), raw: JSON.stringify({ note: "x".repeat(40_000) }) })).status, 413);
  assert.equal((await api("POST", "/api/reviews", { token: tok(u), raw: "{nope" })).status, 400);
});

test("bodies: a JSON body of null is 400, not a 500 crash", async () => {
  const u = await viewerOf();
  for (const p of ["/api/me/city", "/api/reviews", "/api/auth/signup"]) {
    const r = await api("POST", p, { token: tok(u), raw: "null" });
    assert.notEqual(r.status, 500, `${p} → 500`);
  }
});

/* ======================= 4. LOGIC ======================= */

test("events: London never shows Lagos events, legacy no-city finds, or other cities' organiser events", async () => {
  await store.put("searches", { id: "london", status: "done", lastSearchAt: iso(0), startedAt: iso(0) });
  const base = { status: "found", kind: "concert", starts: iso(2 * H), ends: iso(5 * H), lineup: ["X"], artistIds: {} };
  await store.put("events", { ...base, id: "e-ldn", city: "London", title: "London gig", venue: { name: "R", lat: 51.51, lon: -0.13 } });
  await store.put("events", { ...base, id: "e-lag", city: "Lagos", title: "Lagos gig", venue: { name: "Q", lat: 6.43, lon: 3.42 } });
  await store.put("events", { ...base, id: "e-old", title: "Old Lagos find", venue: { name: "Q" } });
  await store.put("events", { ...base, id: "e-par", status: "listed", city: "Paris", title: "Paris night", venue: { name: "P", lat: 48.86, lon: 2.35 } });
  const titles = (await ce.eventsInCity("London")).map((e) => e.title);
  assert.deepEqual(titles, ["London gig"]);
  const u = await viewerOf();
  const r = await api("GET", "/api/events", { token: tok(u) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.events.map((e) => e.title), ["London gig"]);
});

test("ensureFresh: two map loads at once on a stale city start one search, not two", async () => {
  await store.put("searches", { id: "london", city: "London", status: "done", lastSearchAt: iso(-30 * H), startedAt: iso(-30 * H) });
  let calls = 0;
  const refresh = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { kept: 0 }; };
  const now = new Date();
  await Promise.all([ce.ensureFresh("London", { now, refresh }), ce.ensureFresh("London", { now, refresh })]);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls, 1, `the web search ran ${calls} times`);
});

test("cron/admin: a search already running (marker under 10 min old) isn't started again", async () => {
  await store.put("searches", { id: "london", city: "London", status: "running", startedAt: iso(-60_000), lastSearchAt: iso(-30 * H) });
  let calls = 0;
  await ce.searchAndMark("London", { refresh: async () => { calls++; return { kept: 0 }; } }).catch(() => {});
  assert.equal(calls, 0, "the cron/admin path ignores the running marker and doubles the search");
});

test("cron: running the same city's refresh twice keeps the same events (no duplicates)", async () => {
  const SRC = "https://example.org/gig";
  const client = { beta: { messages: { create: async () => ({ stop_reason: "end_turn", usage: {}, content: [
    { type: "web_search_tool_result", content: [{ url: SRC }] },
    { type: "text", text: JSON.stringify({ events: [{ title: "Late Jazz", kind: "concert", starts: iso(26 * H), ends: null, venue_name: "Nowhere", area: "Soho", lineup: ["Ezra"], source_url: SRC }] }) },
  ] }) } } };
  const a = await ce.refreshCityEvents("London", { client });
  const b = await ce.refreshCityEvents("London", { client });
  assert.equal(a.total, 1);
  assert.equal(b.total, 1);
});

test("tonight: runs to 06:00 local across midnight and both clock changes", () => {
  const TZ = "Europe/London";
  // Autumn: 25 Oct 2026, clocks go back at 02:00 BST. 00:30 BST → 06:00 GMT.
  assert.equal(nextLocalHour(new Date("2026-10-24T23:30:00Z"), TZ).toISOString(), "2026-10-25T06:00:00.000Z");
  // Spring: 28 Mar 2027, clocks go forward at 01:00 GMT. 00:30 GMT → 06:00 BST.
  assert.equal(nextLocalHour(new Date("2027-03-28T00:30:00Z"), TZ).toISOString(), "2027-03-28T05:00:00.000Z");
  // Exactly 06:00 → tomorrow's 06:00; 05:59 → one minute.
  assert.equal(nextLocalHour(new Date("2026-11-02T06:00:00Z"), TZ).toISOString(), "2026-11-03T06:00:00.000Z");
  assert.equal(timeWindow("tonight", new Date("2026-11-02T05:59:00Z"), TZ).to.toISOString(), "2026-11-02T06:00:00.000Z");
  // Lagos (no DST) at 23:00 local.
  assert.equal(nextLocalHour(new Date("2026-12-18T22:00:00Z"), "Africa/Lagos").toISOString(), "2026-12-19T05:00:00.000Z");
});

test("rides: names with & # ? / and unicode survive the Uber link intact", () => {
  const name = "Ronnie's & Co #1? a=b/ç 🎷";
  const r = rideLinks({ to: { lat: 51.5, lon: -0.13 }, toName: name, cc: "gb" });
  const u = new URL(r.uber);
  assert.equal(u.searchParams.get("dropoff[nickname]"), name);
  assert.equal(u.searchParams.get("pickup"), "my_location");
  assert.equal([...u.searchParams.keys()].filter((k) => k.startsWith("dropoff")).length, 3, "no extra params smuggled in");
  assert.equal(rideLinks({ to: { lat: 13.7, lon: 100.5 }, cc: "TH" }).uber, null);
  assert.throws(() => rideLinks({ to: { lat: NaN, lon: 0 } }));
});

test("ratings: weighted 'people like you' maths at the LIKE_YOU=40 edge; own review left out", () => {
  const sims = { a: 100, b: 40, c: 39, d: null };
  const s = summarize([
    { userId: "a", stars: 5 }, { userId: "b", stars: 1 }, { userId: "c", stars: 1 }, { userId: "d", stars: 1 }, { userId: "me", stars: 1 },
  ], { viewerId: "me", similarity: (r) => sims[r.userId] });
  // w = (m − 30) / 70: a → 1, b → 1/7. (5·1 + 1·1/7) / (8/7) = 4.5
  assert.equal(s.likeYou.avg, 4.5);
  assert.equal(s.likeYou.count, 2);
  assert.equal(s.overall.count, 5);
  assert.equal(s.overall.avg, 1.8);
});

test("reviews: the review day follows the check-in city's clock (Lagos 23:30 vs 00:30)", async () => {
  const u = await viewerOf({ city: "Lagos", email: "lag@x.dev" });
  await store.put("checkins", { userId: u.id, city: "Lagos", venueId: "lagos-club", venueName: "Quilox", venueLocation: PLACES["lagos-club"].location, at: "2026-10-30T20:00:00Z", expiresAt: "2026-10-31T05:00:00Z" });
  const a = await addReview(u, { placeId: "lagos-club", stars: 4, note: "" }, new Date("2026-10-30T22:30:00Z")); // 23:30 Lagos
  await assert.rejects(addReview(u, { placeId: "lagos-club", stars: 4, note: "" }, new Date("2026-10-30T22:50:00Z")), (e) => e.status === 409);
  const b = await addReview(u, { placeId: "lagos-club", stars: 4, note: "" }, new Date("2026-10-30T23:30:00Z")); // 00:30 Lagos, next day
  assert.notEqual(a.day, b.day);
});

/* ======================= 5. FIXES (passwords, rate limits) ======================= */

test("auth: passwords: short refused, hash never returned, wrong password 401, login works, organiser only when new", async () => {
  assert.equal((await api("POST", "/api/auth/signup", { body: { email: "new@x.dev", firstName: "N", password: "short" } })).status, 400);
  assert.equal((await api("POST", "/api/auth/signup", { body: { email: "new@x.dev", firstName: "N" } })).status, 400);
  const r = await api("POST", "/api/auth/signup", { body: { email: "new@x.dev", firstName: "N", password: "correct horse", organiser: true } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.returning, false);
  assert.equal(r.json.user.role, "organiser");
  assert.ok(!/scrypt|passwordHash|correct horse/.test(r.text), "the password or its hash came back");
  const saved = (await store.list("users", (u) => u.email === "new@x.dev"))[0];
  assert.match(saved.passwordHash, /^scrypt\$/);
  assert.ok(!saved.passwordHash.includes("correct horse"));

  const wrong = await api("POST", "/api/auth/signup", { body: { email: "NEW@x.dev", password: "not the one" } });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /already has an account/);
  const again = await api("POST", "/api/auth/signup", { body: { email: "new@x.dev", password: "correct horse" } });
  assert.equal(again.json.returning, true);
  assert.equal(again.json.user.id, saved.id);

  assert.equal((await api("POST", "/api/auth/login", { body: { email: "new@x.dev", password: "nope nope" } })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { body: { email: "nobody@x.dev", password: "correct horse" } })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { body: { email: "new@x.dev", password: { $ne: 1 } } })).status, 401);
  const ok = await api("POST", "/api/auth/login", { body: { email: "new@x.dev", password: "correct horse" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.id, saved.id);
  assert.equal((await api("GET", "/api/me", { token: ok.json.token })).status, 200);
});

test("organiser: at most 10 event posts an hour", async () => {
  const org = await store.put("users", { email: "rate@v.dev", firstName: "O", role: "organiser", city: "London", favourites: [] });
  const body = { title: "Night", lineup: ["A"], starts: iso(24 * H), venue: { name: "V", lat: 51.51, lon: -0.13 } };
  for (let i = 0; i < 10; i++) assert.equal((await api("POST", "/api/organiser/events", { token: tok(org), body })).status, 200);
  assert.equal((await api("POST", "/api/organiser/events", { token: tok(org), body })).status, 429);
});
