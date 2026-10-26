// Picking a city and where you're staying; the city list over HTTP. Qloo is stubbed.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQlooStub } from "./helpers/qloo-stub.js";

const stub = await startQlooStub((path, p) => {
  if (path === "/search" && /hoxton/i.test(p.query)) return { results: [{ entity_id: "hoxton", name: "The Hoxton, Shoreditch", location: { lat: 51.5246, lon: -0.0794 } }] };
  if (path === "/search" && /eiffel/i.test(p.query)) return { results: [{ entity_id: "eiffel", name: "Eiffel Hotel", location: { lat: 48.8584, lon: 2.2945 } }] };
  return { results: [] };
});
const dir = mkdtempSync(join(tmpdir(), "outside-city-"));
process.env.OUTSIDE_STORE = join(dir, "store.json");
process.env.QLOO_BASE_URL = stub.url;
process.env.QLOO_API_KEY = "test";
process.env.SESSION_SECRET = "x".repeat(40);

const store = await import("../src/store.js");
const people = await import("../src/people.js");
const { handle } = await import("../src/router.js");
const { issueToken } = await import("../src/auth.js");
after(async () => { await stub.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => store.reset());

const newUser = (o = {}) => store.put("users", { firstName: "Ada", email: "ada@x.dev", favourites: [], visibility: "everyone", ...o });

/** Call the router with a fake request and response. */
async function call(method, url, { body, token } = {}) {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await handle({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

test("set the city by name, by GPS, and refuse one we don't cover", async () => {
  const u = await newUser();
  assert.equal((await people.setCity(u, { city: "london" })).city, "London");
  assert.equal((await people.setCity(u, { lat: 48.86, lon: 2.35 })).city, "Paris");
  await assert.rejects(people.setCity(u, { city: "Atlantis" }), (e) => e.status === 400);
  await assert.rejects(people.setCity(u, { lat: 0, lon: -30 }), (e) => e.status === 400);
});

test("changing city clears a stay more than 60 km away, keeps a near one", async () => {
  const stay = { lat: 51.5246, lon: -0.0794, label: "The Hoxton" };
  const u = await newUser({ city: "London", stay });
  assert.deepEqual((await people.setCity(u, { city: "London" })).stay, stay);
  assert.equal((await people.setCity(u, { city: "Paris" })).stay, null);
});

test("where you're staying: by name or point; too far away is 422", async () => {
  const u = await newUser({ city: "London" });
  const byName = await people.setStay(u, "The Hoxton Shoreditch");
  assert.equal(byName.stay.label, "The Hoxton, Shoreditch");
  assert.ok(Math.abs(byName.stay.lat - 51.5246) < 1e-6);
  await assert.rejects(people.setStay(u, "Eiffel Hotel"), (e) => e.status === 422 && /outside London/.test(e.message));
  await assert.rejects(people.setStay(u, { lat: 48.85, lon: 2.35 }), (e) => e.status === 422);
  await assert.rejects(people.setStay(u, "Nowhere Inn"), (e) => e.status === 404);
});

test("GET /api/cities needs no sign-in and lists every city", async () => {
  const res = await call("GET", "/api/cities");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.default, "Lagos");
  assert.equal(res.body.cities.length, 36);
  assert.deepEqual(res.body.cities.find((c) => c.name === "London"), { name: "London", country: "United Kingdom", cc: "GB", tz: "Europe/London", lat: 51.5072, lon: -0.1276 });
});

test("POST /api/me/stay and /api/me/city through the API", async () => {
  const u = await newUser({ city: "London" });
  const token = issueToken(u.id);
  const stay = await call("POST", "/api/me/stay", { token, body: { stay: { lat: 51.52, lon: -0.08, label: "Shoreditch" } } });
  assert.equal(stay.statusCode, 200);
  assert.deepEqual(stay.body.stay, { lat: 51.52, lon: -0.08, label: "Shoreditch" });
  assert.deepEqual(stay.body.user.stay, stay.body.stay);
  const far = await call("POST", "/api/me/stay", { token, body: { stay: { lat: 6.43, lon: 3.42 } } });
  assert.equal(far.statusCode, 422);
  // Pre-mark Paris as searched so warming its events doesn't call Claude.
  await store.put("searches", { id: "paris", status: "done", lastSearchAt: new Date().toISOString(), startedAt: new Date().toISOString() });
  const city = await call("POST", "/api/me/city", { token, body: { city: "Paris" } });
  assert.equal(city.statusCode, 200);
  assert.equal(city.body.city.cc, "FR");
  assert.equal(city.body.user.city, "Paris");
  assert.equal(city.body.user.stay, null);
  assert.equal((await call("POST", "/api/me/city", { token, body: { city: "Atlantis" } })).statusCode, 400);
});
