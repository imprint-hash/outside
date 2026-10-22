/**
 * The HTTP API. One handler, used by the local server (bin/serve.mjs) and by
 * the host's serverless function. Every failure answers JSON with a plain
 * message and the right status; nothing answers an HTML error page.
 */

import { QlooError, searchEntities, stats } from "./qloo.js";
import { AuthError, signUp, userFromToken, selfView } from "./auth.js";
import { resolveOrigin, nearYou, translateCity, tonight, CATEGORIES } from "./places.js";
import { eventsForYou, afterTheShow, seededEvents } from "./events.js";
import * as people from "./people.js";
import { dashboard } from "./organiser.js";
import { get, put, list } from "./store.js";
import { TYPES } from "./taste.js";

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 32 * 1024;

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError("That request is too large.", 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("The request body isn't valid JSON.", 400);
  }
}

async function currentUser(req) {
  const h = req.headers.authorization || "";
  return userFromToken(h.startsWith("Bearer ") ? h.slice(7) : "");
}

const kindsFrom = (v, fallback) => {
  const ks = (Array.isArray(v) ? v : String(v || "").split(",")).map((k) => k.trim()).filter(Boolean);
  const bad = ks.filter((k) => !CATEGORIES[k]);
  if (bad.length) throw new HttpError(`Unknown kind: ${bad.join(", ")}. Use ${Object.keys(CATEGORIES).join(", ")}.`, 400);
  return ks.length ? ks : fallback;
};

async function allEvents() {
  const added = await list("events");
  return [...seededEvents(), ...added];
}

/** [method, path pattern, handler(ctx)] — :name segments become ctx.params. */
const routes = [
  ["GET", "/api/health", async () => ({ ok: true, qloo: stats })],

  ["POST", "/api/auth/signup", async ({ body }) => {
    const { user, token, returning } = await signUp(body);
    if (body.organiser === true && !user.role) await put("users", { ...user, role: "organiser" });
    return { token, returning, user: selfView(await get("users", user.id)) };
  }],
  ["GET", "/api/me", async ({ user }) => ({ user: selfView(user), checkin: await people.myCheckin(user) })],
  ["POST", "/api/me/taste", async ({ user, body }) => {
    if (!Array.isArray(body.items)) throw new HttpError("Send items: [{ type, name }].", 400);
    const { user: saved, missing } = await people.setTaste(user, body.items);
    return { user: selfView(saved), missing };
  }],
  ["POST", "/api/me/visibility", async ({ user, body }) => ({ user: selfView(await people.setVisibility(user, body.visibility)) })],

  ["GET", "/api/search", async ({ query }) => {
    const q = String(query.get("q") || "").trim();
    const type = TYPES[query.get("type")] || TYPES.artist;
    if (q.length < 2) return { results: [] };
    const found = await searchEntities(q, type, 6);
    return { results: found.map((e) => ({ id: e.entity_id, name: e.name, detail: e.properties?.address || e.disambiguation || e.properties?.short_description || null, image: e.properties?.image?.url || null })) };
  }],

  ["POST", "/api/places/near", async ({ user, body }) => {
    const origin = await resolveOrigin(body.stay ?? body.origin);
    const places = await nearYou({ origin, favourites: user.favourites, kinds: kindsFrom(body.kinds, ["restaurant", "lounge", "club", "bar"]), radius: Math.min(15000, Number(body.radius) || 5000), openNow: Boolean(body.openNow) });
    return { origin, places };
  }],
  ["POST", "/api/places/translate", async ({ user, body }) => {
    const origin = body.stay ? await resolveOrigin(body.stay) : null;
    return { origin, places: await translateCity({ favourites: user.favourites, city: body.city || "Lagos", origin, kinds: kindsFrom(body.kinds, ["restaurant", "lounge", "bar", "club"]) }) };
  }],
  ["GET", "/api/places/tonight", async ({ query }) => {
    const venueId = query.get("venueId");
    if (!venueId) throw new HttpError("Which venue are you at? Send venueId.", 400);
    return tonight({ venueId, kinds: kindsFrom(query.get("kinds"), ["restaurant"]) });
  }],

  ["GET", "/api/events", async ({ user, query }) => ({ events: await eventsForYou({ favourites: user.favourites, events: await allEvents(), from: query.get("from"), to: query.get("to") }) })],
  ["GET", "/api/events/:id/after", async ({ user, params }) => {
    const ev = (await allEvents()).find((e) => e.id === params.id);
    if (!ev) throw new HttpError("No such event.", 404);
    return { event: ev.title, places: await afterTheShow({ event: ev, favourites: user.favourites }) };
  }],

  ["POST", "/api/checkin", async ({ user, body }) => {
    if (!body.venueId) throw new HttpError("Which venue? Send venueId.", 400);
    return { checkin: await people.checkIn(user, body.venueId) };
  }],
  ["GET", "/api/checkin", async ({ user }) => ({ checkin: await people.myCheckin(user) })],
  ["DELETE", "/api/checkin", async ({ user }) => (await people.checkOut(user), { checkedOut: true })],
  ["GET", "/api/here", async ({ user }) => people.whoIsHere(user)],

  ["POST", "/api/hello", async ({ user, body }) => ({ hello: await people.sayHi(user, body.to) })],
  ["GET", "/api/hello/inbox", async ({ user }) => ({ hellos: await people.inbox(user) })],
  ["POST", "/api/hello/:id/answer", async ({ user, params, body }) => ({ hello: await people.answerHi(user, params.id, body.accept === true) })],
  ["GET", "/api/hello/:id/messages", async ({ user, params }) => ({ messages: await people.messages(user, params.id) })],
  ["POST", "/api/hello/:id/messages", async ({ user, params, body }) => ({ message: await people.sendMessage(user, params.id, body.text) })],
  ["POST", "/api/hello/:id/meetup", async ({ user, params }) => ({ meetup: await people.startMeetup(user, params.id) })],
  ["GET", "/api/meetup/:id", async ({ user, params }) => ({ meetup: await people.getMeetup(user, params.id) })],
  ["POST", "/api/meetup/:id/position", async ({ user, params, body }) => ({ meetup: await people.updatePosition(user, params.id, body) })],
  ["POST", "/api/meetup/:id/stop", async ({ user, params }) => people.stopMeetup(user, params.id)],

  ["POST", "/api/block", async ({ user, body }) => (await people.block(user, body.userId), { blocked: true })],
  ["POST", "/api/report", async ({ user, body }) => (await people.report(user, body.userId, body.reason), { reported: true, blocked: true })],
  ["GET", "/api/share-night", async ({ user }) => people.shareMyNight(user)],

  ["GET", "/api/organiser/dashboard", async ({ user, query }) => {
    if (user.role !== "organiser") throw new HttpError("This view is for event organisers and venues.", 403);
    const mine = (await allEvents()).filter((e) => e.ownerId === user.id || e.status === "announced");
    return dashboard({ days: Math.min(30, Number(query.get("days")) || 7), events: mine });
  }],
  ["POST", "/api/organiser/events", async ({ user, body }) => {
    if (user.role !== "organiser") throw new HttpError("Only organisers can add events.", 403);
    const title = String(body.title || "").trim().slice(0, 120);
    const lineup = (Array.isArray(body.lineup) ? body.lineup : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    const starts = new Date(body.starts), ends = new Date(body.ends || body.starts);
    const lat = Number(body.venue?.lat), lon = Number(body.venue?.lon);
    if (!title || !lineup.length || isNaN(starts) || isNaN(ends) || ends < starts || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new HttpError("An event needs a title, a lineup, start and end times, and a venue with lat and lon.", 400);
    }
    return { event: await put("events", { title, kind: body.kind || "event", status: "listed", ownerId: user.id, starts: starts.toISOString(), ends: ends.toISOString(), venue: { name: String(body.venue.name || "Venue").slice(0, 80), lat, lon }, lineup }) };
  }],
];

const PUBLIC = new Set(["/api/health", "/api/auth/signup", "/api/search"]);

function match(method, path) {
  for (const [m, pattern, fn] of routes) {
    if (m !== method) continue;
    const a = pattern.split("/"), b = path.split("/");
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeURIComponent(b[i])), true) : seg === b[i]))) return { fn, params, pattern };
  }
  return null;
}

export async function handle(req, res) {
  const url = new URL(req.url, "http://local");
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  try {
    const hit = match(req.method, url.pathname.replace(/\/$/, ""));
    if (!hit) return send(404, { error: "No such endpoint." });
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};
    const user = PUBLIC.has(hit.pattern) ? null : await currentUser(req);
    if (user && !PUBLIC.has(hit.pattern) && /^\/api\/(places\/(near|translate)|events)/.test(hit.pattern) && !user.favourites?.length) {
      throw new HttpError("Add a few things you love first, so picks can match your taste.", 409);
    }
    return send(200, await hit.fn({ req, body, user, params: hit.params, query: url.searchParams }));
  } catch (err) {
    const known = err instanceof HttpError || err instanceof QlooError || err instanceof AuthError || err instanceof people.RuleError;
    if (!known) console.error(err);
    return send(known ? err.status || 400 : 500, { error: known ? err.message : "Something went wrong on our side. Please try again." });
  }
}
